/**
 * One Pace Manager - API Integration
 *
 * Handles all API communications with Plex, Jellyfin, and Google Sheets
 */

// Base API class for common functionality
class BaseAPI {
  constructor(config) {
    this.config = config;
    this.timeout = config.timeout || 30000;
  }

  // CORS-aware fetch with retry logic
  async fetch(url, options = {}) {
    const fetchOptions = {
      ...options,
      signal: AbortSignal.timeout(this.timeout),
    };

    return await AsyncUtils.retry(async () => {
      try {
        // Try direct fetch first
        Logger.debug(`Attempting direct fetch: ${url}`);
        const response = await fetch(url, fetchOptions);

        if (!response.ok && response.status !== 404) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
      } catch (error) {
        // If CORS error, try proxy
        if (error.message.includes("CORS") || error.name === "TypeError") {
          Logger.debug(`CORS error detected, trying proxy: ${url}`);
          const proxyUrl =
            API_CONFIG.corsProxy.primary + encodeURIComponent(url);

          const response = await fetch(proxyUrl, {
            ...fetchOptions,
            signal: AbortSignal.timeout(this.timeout),
          });

          if (!response.ok) {
            throw new Error(`Proxy request failed: HTTP ${response.status}`);
          }

          return response;
        }

        throw error;
      }
    });
  }

  // Parse XML response
  parseXML(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");

    // Check for parsing errors
    const parserError = xmlDoc.querySelector("parsererror");
    if (parserError) {
      throw new Error(`XML parsing error: ${parserError.textContent}`);
    }

    return xmlDoc;
  }

  // Format error message
  formatError(error) {
    if (error.name === "AbortError") {
      return "Request timed out";
    }

    return error.message || "Unknown error occurred";
  }
}

// Plex API integration
class PlexAPI extends BaseAPI {
  constructor() {
    super(API_CONFIG.plex);
    this.token = null;
  }

  // Authenticate with Plex
  async authenticate(username, password) {
    Logger.info("Authenticating with Plex...");

    const base64Auth = btoa(`${username}:${password}`);

    try {
      const response = await this.fetch(this.config.signInUrl, {
        method: "POST",
        headers: {
          ...this.config.headers,
          Authorization: `Basic ${base64Auth}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Authentication failed: ${response.status}`);
      }

      const xmlText = await response.text();
      const xmlDoc = this.parseXML(xmlText);

      const userElement = xmlDoc.querySelector("user");
      if (!userElement) {
        throw new Error("No user element in response");
      }

      const authToken = userElement.getAttribute("authToken");
      if (!authToken) {
        throw new Error("No auth token in response");
      }

      this.token = authToken;
      Logger.info("Plex authentication successful");

      return {
        token: authToken,
        user: {
          id: userElement.getAttribute("id"),
          username: userElement.getAttribute("username"),
          email: userElement.getAttribute("email"),
        },
      };
    } catch (error) {
      Logger.error("Plex authentication failed:", error);
      throw new Error(this.formatError(error));
    }
  }

  // Get available servers
  async getServers() {
    if (!this.token) {
      throw new Error("Not authenticated - no token available");
    }

    Logger.info("Fetching Plex servers...");

    try {
      const url = `${this.config.serversUrl}?X-Plex-Token=${this.token}`;
      const response = await this.fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch servers: ${response.status}`);
      }

      const xmlText = await response.text();
      const xmlDoc = this.parseXML(xmlText);

      const servers = Array.from(xmlDoc.querySelectorAll("Server")).map(
        (server) => ({
          name: server.getAttribute("name"),
          address: server.getAttribute("address"),
          port: server.getAttribute("port"),
          version: server.getAttribute("version"),
          accessToken: server.getAttribute("accessToken"),
          scheme: server.getAttribute("scheme") || "http",
          owned: server.getAttribute("owned") === "1",
        })
      );

      Logger.info(`Found ${servers.length} Plex servers`);
      return servers;
    } catch (error) {
      Logger.error("Failed to fetch Plex servers:", error);
      throw new Error(this.formatError(error));
    }
  }

  // Search for shows on a specific server
  async searchShows(server, query) {
    Logger.info(`Searching Plex for: ${query}`);

    try {
      const searchUrl =
        `${server.scheme}://${server.address}:${server.port}/search` +
        `?query=${encodeURIComponent(query)}&X-Plex-Token=${this.token}`;

      const response = await this.fetch(searchUrl);

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const xmlText = await response.text();
      const xmlDoc = this.parseXML(xmlText);

      const shows = Array.from(
        xmlDoc.querySelectorAll('Directory[type="show"]')
      ).map((show) => ({
        title: show.getAttribute("title"),
        ratingKey: show.getAttribute("ratingKey"),
        year: show.getAttribute("year"),
        summary: show.getAttribute("summary"),
        thumb: show.getAttribute("thumb"),
        art: show.getAttribute("art"),
      }));

      Logger.info(`Found ${shows.length} shows matching "${query}"`);
      return shows;
    } catch (error) {
      Logger.error("Plex search failed:", error);
      throw new Error(this.formatError(error));
    }
  }

  // Get show metadata including seasons and episodes
  async getShowMetadata(server, ratingKey) {
    Logger.info(`Fetching show metadata for rating key: ${ratingKey}`);

    try {
      // Get seasons
      const seasonsUrl = `${server.scheme}://${server.address}:${server.port}/library/metadata/${ratingKey}/children?X-Plex-Token=${this.token}`;
      const seasonsResponse = await this.fetch(seasonsUrl);

      if (!seasonsResponse.ok) {
        throw new Error(`Failed to fetch seasons: ${seasonsResponse.status}`);
      }

      const seasonsXml = await seasonsResponse.text();
      const seasonsDoc = this.parseXML(seasonsXml);

      const seasons = Array.from(
        seasonsDoc.querySelectorAll('Directory[type="season"]')
      )
        .filter((season) => season.getAttribute("title") !== "All episodes")
        .map((season) => ({
          id: season.getAttribute("ratingKey"),
          title: season.getAttribute("title"),
          number: parseInt(season.getAttribute("index")),
          summary: season.getAttribute("summary"),
          thumb: season.getAttribute("thumb"),
          episodes: [],
        }));

      // Get episodes for each season
      for (const season of seasons) {
        const episodesUrl = `${server.scheme}://${server.address}:${server.port}/library/metadata/${season.id}/children?X-Plex-Token=${this.token}`;
        const episodesResponse = await this.fetch(episodesUrl);

        if (episodesResponse.ok) {
          const episodesXml = await episodesResponse.text();
          const episodesDoc = this.parseXML(episodesXml);

          season.episodes = Array.from(
            episodesDoc.querySelectorAll("Video")
          ).map((episode) => ({
            id: episode.getAttribute("ratingKey"),
            title: episode.getAttribute("title"),
            number: parseInt(episode.getAttribute("index")),
            summary: episode.getAttribute("summary"),
            originallyAvailableAt: episode.getAttribute(
              "originallyAvailableAt"
            ),
            thumb: episode.getAttribute("thumb"),
          }));
        }
      }

      Logger.info(`Loaded metadata for ${seasons.length} seasons`);
      return { seasons };
    } catch (error) {
      Logger.error("Failed to fetch show metadata:", error);
      throw new Error(this.formatError(error));
    }
  }

  // Update item metadata
  async updateMetadata(server, itemId, updates) {
    Logger.debug(`Updating metadata for item ${itemId}:`, updates);

    try {
      const params = new URLSearchParams();

      if (updates.title) params.append("title", updates.title);
      if (updates.summary) params.append("summary", updates.summary);
      if (updates.originallyAvailableAt)
        params.append("originallyAvailableAt", updates.originallyAvailableAt);

      const updateUrl = `${server.scheme}://${server.address}:${
        server.port
      }/library/metadata/${itemId}?${params.toString()}&X-Plex-Token=${
        this.token
      }`;

      const response = await this.fetch(updateUrl, { method: "PUT" });

      if (!response.ok) {
        throw new Error(`Update failed: ${response.status}`);
      }

      Logger.debug(`Successfully updated metadata for item ${itemId}`);
    } catch (error) {
      Logger.error(`Failed to update metadata for item ${itemId}:`, error);
      throw new Error(this.formatError(error));
    }
  }

  // Upload poster
  async uploadPoster(server, itemId, imageData) {
    Logger.debug(`Uploading poster for item ${itemId}`);

    try {
      const uploadUrl = `${server.scheme}://${server.address}:${server.port}/library/metadata/${itemId}/posters?X-Plex-Token=${this.token}`;

      const response = await this.fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body: imageData,
      });

      if (!response.ok) {
        throw new Error(`Poster upload failed: ${response.status}`);
      }

      Logger.debug(`Successfully uploaded poster for item ${itemId}`);
    } catch (error) {
      Logger.error(`Failed to upload poster for item ${itemId}:`, error);
      throw new Error(this.formatError(error));
    }
  }
}

// Jellyfin API integration
class JellyfinAPI extends BaseAPI {
  constructor() {
    super(API_CONFIG.jellyfin);
    this.serverUrl = null;
    this.apiKey = null;
    this.userId = null;
  }

  // Test connection to Jellyfin server
  async testConnection(serverUrl, apiKey) {
    Logger.info("Testing Jellyfin connection...");

    try {
      const url =
        serverUrl.replace(/\/$/, "") + this.config.endpoints.systemInfo;

      const response = await this.fetch(url, {
        headers: {
          ...this.config.headers,
          "X-Emby-Token": apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Connection test failed: ${response.status}`);
      }

      const data = await response.json();

      this.serverUrl = serverUrl.replace(/\/$/, "");
      this.apiKey = apiKey;

      Logger.info(`Successfully connected to Jellyfin: ${data.ServerName}`);
      return {
        serverName: data.ServerName,
        version: data.Version,
        id: data.Id,
      };
    } catch (error) {
      Logger.error("Jellyfin connection test failed:", error);
      throw new Error(this.formatError(error));
    }
  }

  // Get users (needed for API calls)
  async getUsers() {
    if (!this.serverUrl || !this.apiKey) {
      throw new Error("Not connected to Jellyfin server");
    }

    try {
      const url = this.serverUrl + this.config.endpoints.users;

      const response = await this.fetch(url, {
        headers: {
          ...this.config.headers,
          "X-Emby-Token": this.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch users: ${response.status}`);
      }

      const users = await response.json();

      if (users.length > 0) {
        this.userId = users[0].Id;
        Logger.info(`Using Jellyfin user: ${users[0].Name}`);
      }

      return users;
    } catch (error) {
      Logger.error("Failed to fetch Jellyfin users:", error);
      throw new Error(this.formatError(error));
    }
  }

  // Search for shows
  async searchShows(query) {
    if (!this.userId) {
      await this.getUsers();
    }

    Logger.info(`Searching Jellyfin for: ${query}`);

    try {
      const url =
        this.serverUrl +
        this.config.endpoints.items.replace("{userId}", this.userId) +
        `?SearchTerm=${encodeURIComponent(query)}&IncludeItemTypes=Series`;

      const response = await this.fetch(url, {
        headers: {
          ...this.config.headers,
          "X-Emby-Token": this.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const data = await response.json();

      const shows = data.Items.map((show) => ({
        title: show.Name,
        id: show.Id,
        year: show.ProductionYear,
        summary: show.Overview,
        thumb: show.ImageTags?.Primary
          ? `${this.serverUrl}/Items/${show.Id}/Images/Primary`
          : null,
      }));

      Logger.info(`Found ${shows.length} shows matching "${query}"`);
      return shows;
    } catch (error) {
      Logger.error("Jellyfin search failed:", error);
      throw new Error(this.formatError(error));
    }
  }

  // Get show metadata
  async getShowMetadata(showId) {
    Logger.info(`Fetching Jellyfin show metadata for: ${showId}`);

    try {
      // Get seasons
      const seasonsUrl =
        this.serverUrl +
        this.config.endpoints.seasons.replace("{showId}", showId);
      const seasonsResponse = await this.fetch(seasonsUrl, {
        headers: {
          ...this.config.headers,
          "X-Emby-Token": this.apiKey,
        },
      });

      if (!seasonsResponse.ok) {
        throw new Error(`Failed to fetch seasons: ${seasonsResponse.status}`);
      }

      const seasonsData = await seasonsResponse.json();

      const seasons = seasonsData.Items.map((season) => ({
        id: season.Id,
        title: season.Name,
        number: season.IndexNumber,
        summary: season.Overview,
        episodes: [],
      }));

      // Get episodes for each season
      for (const season of seasons) {
        const episodesUrl =
          this.serverUrl +
          this.config.endpoints.episodes.replace("{showId}", showId) +
          `?SeasonId=${season.id}`;

        const episodesResponse = await this.fetch(episodesUrl, {
          headers: {
            ...this.config.headers,
            "X-Emby-Token": this.apiKey,
          },
        });

        if (episodesResponse.ok) {
          const episodesData = await episodesResponse.json();

          season.episodes = episodesData.Items.map((episode) => ({
            id: episode.Id,
            title: episode.Name,
            number: episode.IndexNumber,
            summary: episode.Overview,
            originallyAvailableAt: episode.PremiereDate?.split("T")[0],
          }));
        }
      }

      Logger.info(`Loaded metadata for ${seasons.length} seasons`);
      return { seasons };
    } catch (error) {
      Logger.error("Failed to fetch Jellyfin show metadata:", error);
      throw new Error(this.formatError(error));
    }
  }

  // Update item metadata
  async updateMetadata(itemId, updates) {
    Logger.debug(`Updating Jellyfin metadata for item ${itemId}:`, updates);

    try {
      // First get the current item data
      const getUrl = `${this.serverUrl}/Items/${itemId}`;
      const getResponse = await this.fetch(getUrl, {
        headers: {
          ...this.config.headers,
          "X-Emby-Token": this.apiKey,
        },
      });

      if (!getResponse.ok) {
        throw new Error(
          `Failed to get current item data: ${getResponse.status}`
        );
      }

      const currentData = await getResponse.json();

      // Merge updates with current data
      const updatedData = {
        ...currentData,
        Name: updates.title || currentData.Name,
        Overview: updates.summary || currentData.Overview,
        PremiereDate: updates.originallyAvailableAt || currentData.PremiereDate,
      };

      // Update the item
      const updateUrl = `${this.serverUrl}/Items/${itemId}`;
      const response = await this.fetch(updateUrl, {
        method: "POST",
        headers: {
          ...this.config.headers,
          "X-Emby-Token": this.apiKey,
        },
        body: JSON.stringify(updatedData),
      });

      if (!response.ok) {
        throw new Error(`Update failed: ${response.status}`);
      }

      Logger.debug(`Successfully updated Jellyfin metadata for item ${itemId}`);
    } catch (error) {
      Logger.error(
        `Failed to update Jellyfin metadata for item ${itemId}:`,
        error
      );
      throw new Error(this.formatError(error));
    }
  }
}

// Google Sheets API integration
class GoogleSheetsAPI extends BaseAPI {
  constructor() {
    super(API_CONFIG.googleSheets);
  }

  // Build CSV URL for a sheet
  buildSheetUrl(sheetId, gid) {
    return `${this.config.baseUrl}/${sheetId}/export?format=csv&gid=${gid}`;
  }

  // Fetch and parse sheet data
  async getSheetData(sheetConfig) {
    Logger.info(`Fetching Google Sheet data: ${sheetConfig.sheetId}`);

    try {
      const url = this.buildSheetUrl(sheetConfig.sheetId, sheetConfig.gid);
      const response = await this.fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch sheet: ${response.status}`);
      }

      const csvText = await response.text();
      const data = CSVUtils.parse(csvText);

      Logger.info(`Loaded ${data.length} rows from Google Sheet`);
      return data;
    } catch (error) {
      Logger.error("Failed to fetch Google Sheet data:", error);
      throw new Error(this.formatError(error));
    }
  }

  // Get season mapping data
  async getSeasonMapping() {
    return await this.getSheetData(this.config.seasonMapping);
  }

  // Get episode data
  async getEpisodeData() {
    return await this.getSheetData(this.config.episodeData);
  }

  // Get release data
  async getReleaseData() {
    return await this.getSheetData(this.config.releaseData);
  }

  // Get all sheet data at once
  async getAllData() {
    Logger.info("Fetching all Google Sheets data...");

    try {
      const [seasonMapping, episodeData, releaseData] = await Promise.all([
        this.getSeasonMapping(),
        this.getEpisodeData(),
        this.getReleaseData(),
      ]);

      return {
        seasonMapping,
        episodeData,
        releaseData,
      };
    } catch (error) {
      Logger.error("Failed to fetch all Google Sheets data:", error);
      throw new Error(this.formatError(error));
    }
  }
}

// GitHub API for assets
class GitHubAPI extends BaseAPI {
  constructor() {
    super(API_CONFIG.github);
  }

  // Download assets ZIP file
  async downloadAssets() {
    Logger.info("Downloading One Pace assets from GitHub...");

    try {
      const response = await this.fetch(this.config.assetsUrl);

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();

      Logger.info(
        `Downloaded ${NumberUtils.formatBytes(
          arrayBuffer.byteLength
        )} of assets`
      );
      return arrayBuffer;
    } catch (error) {
      Logger.error("Failed to download GitHub assets:", error);
      throw new Error(this.formatError(error));
    }
  }
}

// API Manager - coordinates all APIs
class APIManager {
  constructor() {
    this.plex = new PlexAPI();
    this.jellyfin = new JellyfinAPI();
    this.googleSheets = new GoogleSheetsAPI();
    this.github = new GitHubAPI();
  }

  // Get appropriate API based on service
  getAPI(service) {
    switch (service) {
      case "plex":
        return this.plex;
      case "jellyfin":
        return this.jellyfin;
      default:
        throw new Error(`Unknown service: ${service}`);
    }
  }

  // Test all connections
  async testConnections() {
    const results = {};

    // Test Plex if token available
    if (this.plex.token) {
      try {
        await this.plex.getServers();
        results.plex = { status: "connected", error: null };
      } catch (error) {
        results.plex = { status: "error", error: error.message };
      }
    } else {
      results.plex = { status: "disconnected", error: null };
    }

    // Test Jellyfin if configured
    if (this.jellyfin.serverUrl && this.jellyfin.apiKey) {
      try {
        await this.jellyfin.getUsers();
        results.jellyfin = { status: "connected", error: null };
      } catch (error) {
        results.jellyfin = { status: "error", error: error.message };
      }
    } else {
      results.jellyfin = { status: "disconnected", error: null };
    }

    return results;
  }
}

// Export API classes
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BaseAPI,
    PlexAPI,
    JellyfinAPI,
    GoogleSheetsAPI,
    GitHubAPI,
    APIManager,
  };
}
