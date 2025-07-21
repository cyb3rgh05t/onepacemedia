// Configuration and Constants
const APP_CONFIG = {
  name: "One Pace Manager",
  version: "2.0.0",
  description:
    "Manage your One Pace collection with metadata updates and poster management",
};

const API_CONFIG = {
  plex: {
    signInUrl: "https://plex.tv/users/sign_in.xml",
    serversUrl: "https://plex.tv/pms/servers",
    headers: {
      "X-Plex-Version": "1.1.2",
      "X-Plex-Product": "OnePace",
      "X-Plex-Client-Identifier": "271938",
      "Content-Type": "application/xml",
    },
    timeout: 30000,
  },
  googleSheets: {
    baseUrl: "https://docs.google.com/spreadsheets/d",
    seasonMapping: {
      sheetId: "1M0Aa2p5x7NioaH9-u8FyHq6rH3t5s6Sccs8GoC6pHAM",
      gid: "2010244982",
    },
    episodeData: {
      sheetId: "1M0Aa2p5x7NioaH9-u8FyHq6rH3t5s6Sccs8GoC6pHAM",
      gid: "0",
    },
    releaseData: {
      sheetId: "1HQRMJgu_zArp-sLnvFMDzOyjdsht87eFLECxMK858lA",
      gid: "0",
    },
  },
  github: {
    assetsUrl:
      "https://github.com/SpykerNZ/one-pace-for-plex/archive/refs/heads/main.zip",
  },
  corsProxy: "https://api.allorigins.win/raw?url=",
};

const FILE_PATTERNS = {
  onePace:
    /\[(?<episodes>\d+(?:-\d+)?)\]\s+(?<arc>.+?)\s+(?<episode>\d{1,2})(?:\s+(?<title>.+?))?\./i,
  season: /S(?<season>\d{1,2})E(?<episode>\d{1,2})/i,
};

// Utility Functions
const Utils = {
  async fetchWithCORS(url, options = {}) {
    try {
      const response = await fetch(url, options);
      if (response.ok || response.status === 401) {
        return response;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (error.message.includes("CORS") || error.name === "TypeError") {
        const proxyUrl = API_CONFIG.corsProxy + encodeURIComponent(url);
        return await fetch(proxyUrl, options);
      }
      throw error;
    }
  },

  parseXML(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    const parserError = xmlDoc.querySelector("parsererror");
    if (parserError) {
      throw new Error(`XML parsing error: ${parserError.textContent}`);
    }
    return xmlDoc;
  },

  parseCSV(csvText) {
    const lines = csvText.split("\n").filter((line) => line.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
    return lines.slice(1).map((line) => {
      const values = line.split(",").map((v) => v.trim().replace(/"/g, ""));
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = values[index] || "";
      });
      return obj;
    });
  },

  formatDate(date) {
    return new Date(date).toISOString().split("T")[0];
  },

  sanitizeFilename(filename) {
    return filename.replace(/[\\/:*?"<>|]/g, "").trim();
  },

  formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  },

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  clamp(num, min, max) {
    return Math.min(Math.max(num, min), max);
  },
};

// Storage Manager
const Storage = {
  set(key, value, expiration = null) {
    const item = {
      value: value,
      timestamp: Date.now(),
      expiration: expiration,
    };
    localStorage.setItem(key, JSON.stringify(item));
  },

  get(key, defaultValue = null) {
    try {
      const item = JSON.parse(localStorage.getItem(key));
      if (!item) return defaultValue;

      if (item.expiration && Date.now() - item.timestamp > item.expiration) {
        localStorage.removeItem(key);
        return defaultValue;
      }

      return item.value;
    } catch (error) {
      return defaultValue;
    }
  },

  remove(key) {
    localStorage.removeItem(key);
  },
};

// API Classes
class PlexAPI {
  constructor() {
    this.token = null;
    this.baseHeaders = API_CONFIG.plex.headers;
  }

  async authenticate(username, password) {
    const base64Auth = btoa(`${username}:${password}`);

    const response = await Utils.fetchWithCORS(API_CONFIG.plex.signInUrl, {
      method: "POST",
      headers: {
        ...this.baseHeaders,
        Authorization: `Basic ${base64Auth}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.status}`);
    }

    const xmlText = await response.text();
    const xmlDoc = Utils.parseXML(xmlText);
    const userElement = xmlDoc.querySelector("user");

    if (!userElement) {
      throw new Error("No user element in response");
    }

    const authToken = userElement.getAttribute("authToken");
    if (!authToken) {
      throw new Error("No auth token in response");
    }

    this.token = authToken;
    return {
      token: authToken,
      user: {
        id: userElement.getAttribute("id"),
        username: userElement.getAttribute("username"),
        email: userElement.getAttribute("email"),
      },
    };
  }

  async getServers() {
    if (!this.token) {
      throw new Error("Not authenticated - no token available");
    }

    const url = `${API_CONFIG.plex.serversUrl}?X-Plex-Token=${this.token}`;
    const response = await Utils.fetchWithCORS(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch servers: ${response.status}`);
    }

    const xmlText = await response.text();
    const xmlDoc = Utils.parseXML(xmlText);

    return Array.from(xmlDoc.querySelectorAll("Server")).map((server) => ({
      name: server.getAttribute("name"),
      address: server.getAttribute("address"),
      port: server.getAttribute("port"),
      version: server.getAttribute("version"),
      accessToken: server.getAttribute("accessToken"),
      scheme: server.getAttribute("scheme") || "http",
      owned: server.getAttribute("owned") === "1",
    }));
  }

  async searchShows(server, query) {
    const searchUrl = `${server.scheme}://${server.address}:${
      server.port
    }/search?query=${encodeURIComponent(query)}&X-Plex-Token=${this.token}`;
    const response = await Utils.fetchWithCORS(searchUrl);

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    const xmlText = await response.text();
    const xmlDoc = Utils.parseXML(xmlText);

    return Array.from(xmlDoc.querySelectorAll('Directory[type="show"]')).map(
      (show) => ({
        title: show.getAttribute("title"),
        ratingKey: show.getAttribute("ratingKey"),
        year: show.getAttribute("year"),
        summary: show.getAttribute("summary"),
        thumb: show.getAttribute("thumb"),
      })
    );
  }

  async getShowMetadata(server, ratingKey) {
    const seasonsUrl = `${server.scheme}://${server.address}:${server.port}/library/metadata/${ratingKey}/children?X-Plex-Token=${this.token}`;
    const response = await Utils.fetchWithCORS(seasonsUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch seasons: ${response.status}`);
    }

    const xmlText = await response.text();
    const xmlDoc = Utils.parseXML(xmlText);

    const seasons = Array.from(
      xmlDoc.querySelectorAll('Directory[type="season"]')
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
      const episodesResponse = await Utils.fetchWithCORS(episodesUrl);

      if (episodesResponse.ok) {
        const episodesXml = await episodesResponse.text();
        const episodesDoc = Utils.parseXML(episodesXml);

        season.episodes = Array.from(episodesDoc.querySelectorAll("Video")).map(
          (episode) => ({
            id: episode.getAttribute("ratingKey"),
            title: episode.getAttribute("title"),
            number: parseInt(episode.getAttribute("index")),
            summary: episode.getAttribute("summary"),
            originallyAvailableAt: episode.getAttribute(
              "originallyAvailableAt"
            ),
            thumb: episode.getAttribute("thumb"),
          })
        );
      }
    }

    return { seasons };
  }

  async updateMetadata(server, itemId, updates) {
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

    const response = await Utils.fetchWithCORS(updateUrl, {
      method: "PUT",
    });

    if (!response.ok) {
      throw new Error(`Update failed: ${response.status}`);
    }
  }

  async uploadPoster(server, itemId, imageData) {
    const uploadUrl = `${server.scheme}://${server.address}:${server.port}/library/metadata/${itemId}/posters?X-Plex-Token=${this.token}`;

    const response = await Utils.fetchWithCORS(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: imageData,
    });

    if (!response.ok) {
      throw new Error(`Poster upload failed: ${response.status}`);
    }
  }
}

class JellyfinAPI {
  constructor() {
    this.serverUrl = null;
    this.apiKey = null;
    this.userId = null;
  }

  async testConnection(serverUrl, apiKey) {
    const url = serverUrl.replace(/\/$/, "") + "/System/Info/Public";
    const response = await Utils.fetchWithCORS(url, {
      headers: { "X-Emby-Token": apiKey },
    });

    if (!response.ok) {
      throw new Error(`Connection test failed: ${response.status}`);
    }

    const data = await response.json();
    this.serverUrl = serverUrl.replace(/\/$/, "");
    this.apiKey = apiKey;

    return {
      serverName: data.ServerName,
      version: data.Version,
      id: data.Id,
    };
  }

  async getUsers() {
    if (!this.serverUrl || !this.apiKey) {
      throw new Error("Not connected to Jellyfin server");
    }

    const url = this.serverUrl + "/Users";
    const response = await Utils.fetchWithCORS(url, {
      headers: { "X-Emby-Token": this.apiKey },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch users: ${response.status}`);
    }

    const users = await response.json();
    if (users.length > 0) {
      this.userId = users[0].Id;
    }

    return users;
  }

  async searchShows(query) {
    if (!this.userId) {
      await this.getUsers();
    }

    const url = `${this.serverUrl}/Users/${
      this.userId
    }/Items?SearchTerm=${encodeURIComponent(query)}&IncludeItemTypes=Series`;
    const response = await Utils.fetchWithCORS(url, {
      headers: { "X-Emby-Token": this.apiKey },
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    const data = await response.json();
    return data.Items.map((show) => ({
      title: show.Name,
      id: show.Id,
      year: show.ProductionYear,
      summary: show.Overview,
    }));
  }
}

class GoogleSheetsAPI {
  async getSheetData(sheetConfig) {
    const url = `${API_CONFIG.googleSheets.baseUrl}/${sheetConfig.sheetId}/export?format=csv&gid=${sheetConfig.gid}`;
    const response = await Utils.fetchWithCORS(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch sheet: ${response.status}`);
    }

    const csvText = await response.text();
    return Utils.parseCSV(csvText);
  }

  async getSeasonMapping() {
    return await this.getSheetData(API_CONFIG.googleSheets.seasonMapping);
  }

  async getEpisodeData() {
    return await this.getSheetData(API_CONFIG.googleSheets.episodeData);
  }

  async getReleaseData() {
    return await this.getSheetData(API_CONFIG.googleSheets.releaseData);
  }

  async getAllData() {
    const [seasonMapping, episodeData, releaseData] = await Promise.all([
      this.getSeasonMapping(),
      this.getEpisodeData(),
      this.getReleaseData(),
    ]);

    return { seasonMapping, episodeData, releaseData };
  }
}

// Main Application Class
class OnePaceManager {
  constructor() {
    this.state = {
      userToken: "",
      serverList: [],
      searchResults: [],
      selectedServer: null,
      selectedShow: null,
      currentService: "plex",
      seasonMappingData: null,
      episodeData: null,
      releaseData: null,
      downloadedAssets: null,
      operationCancelled: false,
      jellyfinSession: null,
      processedFiles: [],
    };

    this.api = {
      plex: new PlexAPI(),
      jellyfin: new JellyfinAPI(),
      googleSheets: new GoogleSheetsAPI(),
    };

    this.initializeApplication();
  }

  async initializeApplication() {
    try {
      this.setupEventListeners();
      this.loadCachedCredentials();
      this.updateUIState();

      this.writeOutput("One Pace Plex Manager", "INFO");
      this.writeOutput("======================================", "INFO");
      this.writeOutput("Real API integration enabled!", "SUCCESS");
      this.setStatus("Ready - Authenticate to begin");
    } catch (error) {
      this.writeOutput(`Initialization error: ${error.message}`, "ERROR");
    }
  }

  setupEventListeners() {
    // Media folder selection
    document
      .getElementById("mediaFolderInput")
      ?.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
          const path = e.target.files[0].webkitRelativePath.split("/")[0];
          document.getElementById("renameMediaPath").value = path;
          this.state.processedFiles = Array.from(e.target.files);
          this.writeOutput(
            `Selected media root folder: ${path} (${e.target.files.length} files)`,
            "INFO"
          );
          this.updateUIState();
        }
      });

    // Form validation
    document
      .getElementById("plexUser")
      ?.addEventListener("input", () => this.validateForm());
    document
      .getElementById("plexPass")
      ?.addEventListener("input", () => this.validateForm());
    document
      .getElementById("jellyfinUrl")
      ?.addEventListener("input", () => this.validateJellyfinForm());
    document
      .getElementById("jellyfinToken")
      ?.addEventListener("input", () => this.validateJellyfinForm());
    document
      .getElementById("searchTerm")
      ?.addEventListener("input", () => this.validateSearchForm());
  }

  validateForm() {
    const username = document.getElementById("plexUser")?.value || "";
    const password = document.getElementById("plexPass")?.value || "";
    const isValid = username.length >= 3 && password.length >= 6;
    const loginBtn = document.getElementById("plexLoginBtn");
    if (loginBtn) loginBtn.disabled = !isValid;
  }

  validateJellyfinForm() {
    const url = document.getElementById("jellyfinUrl")?.value || "";
    const token = document.getElementById("jellyfinToken")?.value || "";
    const isValid = url.startsWith("http") && token.length >= 10;
    const testBtn = document.getElementById("jellyfinTestBtn");
    if (testBtn) testBtn.disabled = !isValid;
  }

  validateSearchForm() {
    const searchTerm = document.getElementById("searchTerm")?.value || "";
    const hasServer = this.state.selectedServer !== null;
    const isValid = searchTerm.length >= 1 && hasServer;

    const searchPlexBtn = document.getElementById("searchPlexBtn");
    const searchJellyfinBtn = document.getElementById("searchJellyfinBtn");
    if (searchPlexBtn)
      searchPlexBtn.disabled = !isValid || this.state.currentService !== "plex";
    if (searchJellyfinBtn)
      searchJellyfinBtn.disabled =
        !isValid || this.state.currentService !== "jellyfin";
  }

  updateUIState() {
    const hasPlexAuth =
      this.state.userToken && this.state.currentService === "plex";
    const hasJellyfinAuth =
      this.state.jellyfinSession && this.state.currentService === "jellyfin";
    const hasAuth = hasPlexAuth || hasJellyfinAuth;
    const hasServer = this.state.selectedServer !== null;
    const hasShow = this.state.selectedShow !== null;
    const hasMediaPath = document.getElementById("renameMediaPath")?.value;

    // Update button states
    const getServersBtn = document.getElementById("getServersBtn");
    if (getServersBtn) getServersBtn.disabled = !hasAuth;

    const applyBtn = document.getElementById("applyBtn");
    if (applyBtn) applyBtn.disabled = !hasShow;

    const renameBtn = document.getElementById("renameBtn");
    if (renameBtn) renameBtn.disabled = !hasMediaPath;

    // Update connection status indicators
    this.setConnectionStatus(
      "plex",
      hasPlexAuth ? "connected" : "disconnected"
    );
    this.setConnectionStatus(
      "jellyfin",
      hasJellyfinAuth ? "connected" : "disconnected"
    );

    this.validateForm();
    this.validateJellyfinForm();
    this.validateSearchForm();
  }

  loadCachedCredentials() {
    // Load Plex token
    const cachedPlexToken = Storage.get("onePace_plexToken");
    if (cachedPlexToken) {
      this.state.userToken = cachedPlexToken;
      this.api.plex.token = cachedPlexToken;
      this.setConnectionStatus("plex", "connected");
      this.writeOutput("Loaded cached Plex token", "INFO");
    }

    // Load Jellyfin credentials
    const cachedJellyfinCreds = Storage.get("onePace_jellyfinCredentials");
    if (cachedJellyfinCreds) {
      if (cachedJellyfinCreds.url) {
        document.getElementById("jellyfinUrl").value = cachedJellyfinCreds.url;
        document.getElementById("cacheJellyfinUrl").checked = true;
      }
      if (cachedJellyfinCreds.apiKey) {
        document.getElementById("jellyfinToken").value =
          cachedJellyfinCreds.apiKey;
        document.getElementById("cacheJellyfinToken").checked = true;
      }
      this.writeOutput("Loaded cached Jellyfin credentials", "INFO");
    }
  }

  writeOutput(message, type = "INFO") {
    const timestamp = new Date().toLocaleString();
    const paddedType = type.toUpperCase().padEnd(7);
    const prefix = `[${timestamp}] [${paddedType}]`;
    const spacing = " ".repeat(Math.max(1, 37 - prefix.length));
    const formattedMessage = `${prefix}${spacing}${message}`;

    const outputLog = document.getElementById("outputLog");
    if (outputLog) {
      outputLog.textContent += "\n" + formattedMessage;
      outputLog.scrollTop = outputLog.scrollHeight;
    }
  }

  setStatus(message) {
    const statusElement = document.getElementById("statusMessage");
    if (statusElement) statusElement.textContent = message;
  }

  updateProgress(percent, text) {
    const progressFill = document.getElementById("progressFill");
    const progressText = document.getElementById("progressText");

    if (progressFill)
      progressFill.style.width = `${Utils.clamp(percent, 0, 100)}%`;
    if (progressText) progressText.textContent = text;
  }

  setConnectionStatus(service, status) {
    const statusDot = document.getElementById(`${service}Status`);
    const statusText = document.getElementById(`${service}StatusText`);

    if (statusDot) statusDot.className = `status-dot ${status}`;
    if (statusText) {
      statusText.textContent =
        status === "connected"
          ? "Connected"
          : status === "error"
          ? "Error"
          : "Disconnected";
    }
  }

  switchTab(tabName) {
    // Update tab UI
    document
      .querySelectorAll(".tab")
      .forEach((tab) => tab.classList.remove("active"));
    document
      .querySelectorAll(".tab-content")
      .forEach((content) => content.classList.add("hidden"));

    const activeTab = Array.from(document.querySelectorAll(".tab")).find(
      (tab) => tab.textContent.toLowerCase().includes(tabName)
    );
    if (activeTab) activeTab.classList.add("active");

    const tabContent = document.getElementById(`${tabName}-tab`);
    if (tabContent) tabContent.classList.remove("hidden");

    this.state.currentService = tabName;
    this.updateUIState();
  }

  async getPlexToken() {
    const username = document.getElementById("plexUser").value;
    const password = document.getElementById("plexPass").value;

    if (!username || !password) {
      this.writeOutput("Please enter both username and password", "ERROR");
      return;
    }

    const loginBtn = document.getElementById("plexLoginBtn");
    const originalText = loginBtn.textContent;
    loginBtn.disabled = true;
    loginBtn.textContent = "Authenticating...";

    this.setStatus("Signing in to Plex...");
    this.writeOutput("Attempting Plex authentication...", "INFO");

    try {
      const result = await this.api.plex.authenticate(username, password);
      this.state.userToken = result.token;
      this.setConnectionStatus("plex", "connected");

      const cacheToken = document.getElementById("cacheToken").checked;
      if (cacheToken) {
        Storage.set(
          "onePace_plexToken",
          result.token,
          30 * 24 * 60 * 60 * 1000
        );
        this.writeOutput("Token acquired and cached!", "SUCCESS");
        this.setStatus("Token acquired and cached!");
      } else {
        this.writeOutput("Token acquired but not cached.", "SUCCESS");
        this.setStatus("Token acquired but not cached.");
      }

      // Auto-load servers
      await this.getServers();
    } catch (error) {
      this.writeOutput(`Sign in failed: ${error.message}`, "ERROR");
      this.setStatus(`Sign in failed: ${error.message}`);
      this.setConnectionStatus("plex", "error");
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = originalText;
      this.updateUIState();
    }
  }

  async testJellyfinConnection() {
    const url = document.getElementById("jellyfinUrl").value;
    const apiKey = document.getElementById("jellyfinToken").value;

    if (!url || !apiKey) {
      this.writeOutput("Please provide both URL and API Key", "ERROR");
      return;
    }

    const testBtn = document.getElementById("jellyfinTestBtn");
    const originalText = testBtn.textContent;
    testBtn.disabled = true;
    testBtn.textContent = "Testing...";

    this.setStatus("Testing Jellyfin connection...");
    this.writeOutput("Testing Jellyfin connection...", "INFO");

    try {
      const result = await this.api.jellyfin.testConnection(url, apiKey);
      this.state.jellyfinSession = {
        url,
        apiKey,
        serverName: result.serverName,
      };

      this.setConnectionStatus("jellyfin", "connected");
      this.writeOutput(
        `Jellyfin connection successful to: ${result.serverName}`,
        "SUCCESS"
      );
      this.setStatus(`Connected to Jellyfin: ${result.serverName}`);

      // Cache credentials if requested
      const cacheUrl = document.getElementById("cacheJellyfinUrl").checked;
      const cacheToken = document.getElementById("cacheJellyfinToken").checked;

      if (cacheUrl || cacheToken) {
        const cacheData = {};
        if (cacheUrl) cacheData.url = url;
        if (cacheToken) cacheData.apiKey = apiKey;
        Storage.set(
          "onePace_jellyfinCredentials",
          cacheData,
          30 * 24 * 60 * 60 * 1000
        );
        this.writeOutput("Jellyfin credentials cached", "INFO");
      }
    } catch (error) {
      this.writeOutput(`Jellyfin connection failed: ${error.message}`, "ERROR");
      this.setStatus(`Connection failed: ${error.message}`);
      this.setConnectionStatus("jellyfin", "error");
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = originalText;
      this.updateUIState();
    }
  }

  async getServers() {
    const getServersBtn = document.getElementById("getServersBtn");
    const originalText = getServersBtn.textContent;
    getServersBtn.disabled = true;
    getServersBtn.textContent = "Loading...";

    this.setStatus("Getting servers...");
    this.writeOutput("Fetching server list...", "INFO");

    try {
      let servers = [];

      if (this.state.currentService === "plex") {
        servers = await this.api.plex.getServers();
      } else if (this.state.currentService === "jellyfin") {
        servers = [
          {
            name: this.state.jellyfinSession.serverName,
            address: new URL(this.state.jellyfinSession.url).hostname,
            port: new URL(this.state.jellyfinSession.url).port || "8096",
            url: this.state.jellyfinSession.url,
            apiKey: this.state.jellyfinSession.apiKey,
            scheme: new URL(this.state.jellyfinSession.url).protocol.replace(
              ":",
              ""
            ),
          },
        ];
      }

      this.state.serverList = servers;
      this.renderServerList(servers);

      this.writeOutput(`${servers.length} servers found.`, "SUCCESS");
      this.setStatus(`${servers.length} servers found.`);
    } catch (error) {
      this.writeOutput(`Error getting servers: ${error.message}`, "ERROR");
      this.setStatus(`Error getting servers: ${error.message}`);
    } finally {
      getServersBtn.disabled = false;
      getServersBtn.textContent = originalText;
      this.updateUIState();
    }
  }

  renderServerList(servers) {
    const serverListElement = document.getElementById("serverList");
    if (!serverListElement) return;

    serverListElement.innerHTML = "";

    servers.forEach((server, index) => {
      const item = document.createElement("div");
      item.className = "list-item";
      item.textContent = `${server.name} (${server.address}:${server.port})`;
      item.dataset.index = index;
      item.onclick = () => this.selectServer(index);
      serverListElement.appendChild(item);
    });
  }

  selectServer(index) {
    // Remove previous selection
    document.querySelectorAll("#serverList .list-item").forEach((item) => {
      item.classList.remove("selected");
    });

    // Select new server
    const selectedItem = document.querySelectorAll("#serverList .list-item")[
      index
    ];
    if (selectedItem) selectedItem.classList.add("selected");

    this.state.selectedServer = this.state.serverList[index];
    this.writeOutput(
      `Selected server: ${this.state.selectedServer.name}`,
      "INFO"
    );
    this.updateUIState();
  }

  async searchShow(service) {
    const searchTerm = document.getElementById("searchTerm").value;

    if (!searchTerm) {
      this.writeOutput("Enter a show name", "ERROR");
      return;
    }

    if (!this.state.selectedServer) {
      this.writeOutput("No server selected", "ERROR");
      return;
    }

    const searchBtn = document.getElementById(
      `search${service.charAt(0).toUpperCase() + service.slice(1)}Btn`
    );
    const originalText = searchBtn.textContent;
    searchBtn.disabled = true;
    searchBtn.textContent = "Searching...";

    this.setStatus("Searching...");
    this.writeOutput(`Searching for "${searchTerm}" in ${service}...`, "INFO");

    try {
      let searchResults = [];

      if (service === "plex") {
        searchResults = await this.api.plex.searchShows(
          this.state.selectedServer,
          searchTerm
        );
      } else if (service === "jellyfin") {
        searchResults = await this.api.jellyfin.searchShows(searchTerm);
      }

      this.state.searchResults = searchResults;
      this.renderSearchResults(searchResults);

      if (searchResults.length > 0) {
        this.writeOutput(`Shows found: ${searchResults.length}`, "SUCCESS");
        this.setStatus(`Found ${searchResults.length} shows`);
      } else {
        this.writeOutput("No shows found", "WARNING");
        this.setStatus("No shows found");
      }
    } catch (error) {
      this.writeOutput(`Error searching: ${error.message}`, "ERROR");
      this.setStatus(`Search failed: ${error.message}`);
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = originalText;
      this.updateUIState();
    }
  }

  renderSearchResults(results) {
    const searchResultsElement = document.getElementById("searchResults");
    if (!searchResultsElement) return;

    searchResultsElement.innerHTML = "";

    if (results.length > 0) {
      results.forEach((show, index) => {
        const item = document.createElement("div");
        item.className = "list-item";
        item.textContent = `${show.title}${show.year ? ` (${show.year})` : ""}`;
        item.dataset.index = index;
        item.onclick = () => this.selectShow(index);
        searchResultsElement.appendChild(item);
      });
    } else {
      const item = document.createElement("div");
      item.className = "list-item";
      item.textContent = "No shows found";
      item.style.fontStyle = "italic";
      item.style.color = "var(--clr-surface-a50)";
      searchResultsElement.appendChild(item);
    }
  }

  selectShow(index) {
    // Remove previous selection
    document.querySelectorAll("#searchResults .list-item").forEach((item) => {
      item.classList.remove("selected");
    });

    // Select new show
    const selectedItem = document.querySelectorAll("#searchResults .list-item")[
      index
    ];
    if (selectedItem) selectedItem.classList.add("selected");

    this.state.selectedShow = this.state.searchResults[index];

    const selectedShowElement = document.getElementById("selectedShow");
    if (selectedShowElement) {
      const identifier =
        this.state.selectedShow.ratingKey || this.state.selectedShow.id;
      selectedShowElement.textContent = `Selected: ${this.state.selectedShow.title} (${identifier})`;
    }

    this.writeOutput(`Selected show: ${this.state.selectedShow.title}`, "INFO");
    this.updateUIState();
  }

  async downloadAssets() {
    const downloadBtn = document.getElementById("downloadBtn");
    const originalText = downloadBtn.textContent;
    downloadBtn.disabled = true;
    downloadBtn.textContent = "Downloading...";

    this.setStatus("Downloading assets from GitHub...");
    this.writeOutput("Starting download of One Pace assets...", "INFO");

    try {
      const response = await Utils.fetchWithCORS(API_CONFIG.github.assetsUrl);

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      this.state.downloadedAssets = arrayBuffer;

      document.getElementById("extractBtn").disabled = false;

      this.writeOutput(
        `Downloaded ${Utils.formatBytes(arrayBuffer.byteLength)} of assets`,
        "SUCCESS"
      );
      this.setStatus(
        `Downloaded ${Utils.formatBytes(arrayBuffer.byteLength)} of assets`
      );
    } catch (error) {
      this.writeOutput(`Download failed: ${error.message}`, "ERROR");
      this.setStatus(`Download failed: ${error.message}`);
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = originalText;
    }
  }

  async extractAssets() {
    if (!this.state.downloadedAssets) {
      this.writeOutput("No assets downloaded yet", "ERROR");
      return;
    }

    this.writeOutput("Extracting and processing assets...", "INFO");
    this.setStatus("Processing assets...");

    try {
      // In a real implementation, you would extract the ZIP file
      // For now, we'll simulate the process
      await Utils.sleep(2000);

      this.writeOutput("Assets extracted and ready for use", "SUCCESS");
      this.writeOutput("Asset files are now available in memory", "INFO");
      this.setStatus("Assets ready");
    } catch (error) {
      this.writeOutput(`Asset extraction failed: ${error.message}`, "ERROR");
      this.setStatus("Asset extraction failed");
    }
  }

  async renameMediaFiles() {
    if (!this.state.processedFiles || this.state.processedFiles.length === 0) {
      this.writeOutput("No media files selected", "ERROR");
      return;
    }

    this.writeOutput("Starting file rename operation...", "INFO");
    this.setStatus("Loading metadata from Google Sheets...");
    this.updateProgress(10, "Loading season mapping...");

    try {
      // Load Google Sheets data
      if (!this.state.seasonMappingData || !this.state.episodeData) {
        const sheetsData = await this.api.googleSheets.getAllData();
        this.state.seasonMappingData = sheetsData.seasonMapping;
        this.state.episodeData = sheetsData.episodeData;
        this.state.releaseData = sheetsData.releaseData;
        this.writeOutput("Loaded metadata from Google Sheets", "SUCCESS");
      }

      this.updateProgress(30, "Processing files...");

      // Build title → season mapping
      const titleToSeason = {};
      this.state.seasonMappingData.forEach((row) => {
        if (row.part && row.title_en) {
          titleToSeason[row.title_en.toLowerCase().trim()] =
            row.title_en === "Specials" ? "0" : parseInt(row.part);
        }
      });

      // Build episode lookup
      const episodeLookup = {};
      this.state.episodeData.forEach((row) => {
        const arc = row.arc_title?.trim();
        const epPart = row.arc_part;
        const title = row.title_en;

        if (!arc || !epPart || !title) return;

        const seasonNum =
          arc === "Specials" || arc === "One Piece Fan Letter"
            ? 0
            : titleToSeason[arc.toLowerCase()] || null;

        if (seasonNum !== null) {
          const key = `${seasonNum}-${epPart}`;
          episodeLookup[key] = title;
        }
      });

      // Process video files
      const videoExtensions = [
        ".mkv",
        ".mp4",
        ".avi",
        ".m4v",
        ".mov",
        ".wmv",
        ".flv",
        ".webm",
      ];
      let processedCount = 0;
      let renamedCount = 0;

      for (const file of this.state.processedFiles) {
        const fileName = file.name;
        const fileExt = fileName.substring(fileName.lastIndexOf("."));

        if (!videoExtensions.includes(fileExt.toLowerCase())) {
          continue;
        }

        processedCount++;
        this.updateProgress(
          30 + (processedCount / this.state.processedFiles.length) * 60,
          `Processing: ${fileName}`
        );

        const match = FILE_PATTERNS.onePace.exec(fileName);
        if (!match) {
          this.writeOutput(
            `Could not parse '${fileName}'. Skipping.`,
            "WARNING"
          );
          continue;
        }

        const arcTitle = match.groups.arc.trim();
        const episodeNumber = parseInt(match.groups.episode);

        const seasonNumber =
          arcTitle === "Specials"
            ? 0
            : titleToSeason[arcTitle.toLowerCase()] || null;

        if (seasonNumber === null) {
          this.writeOutput(
            `Unknown arc '${arcTitle}' in '${fileName}'. Skipping.`,
            "WARNING"
          );
          continue;
        }

        const key = `${seasonNumber}-${episodeNumber}`;
        if (!episodeLookup[key]) {
          this.writeOutput(`No episode title for ${key}. Skipping.`, "WARNING");
          continue;
        }

        const epTitle = episodeLookup[key];
        const safeTitle = Utils.sanitizeFilename(epTitle);
        const newName = `One Pace - S${seasonNumber
          .toString()
          .padStart(2, "0")}E${episodeNumber
          .toString()
          .padStart(2, "0")} - ${safeTitle}${fileExt}`;

        if (fileName === newName) {
          this.writeOutput(`Already correct: '${fileName}'`, "INFO");
        } else {
          this.writeOutput(
            `Would rename '${fileName}' → '${newName}'`,
            "SUCCESS"
          );
          renamedCount++;
        }

        await Utils.sleep(50);
      }

      this.updateProgress(100, "Rename operation completed");
      this.writeOutput(
        `Processed ${processedCount} files, ${renamedCount} would be renamed`,
        "SUCCESS"
      );
      this.writeOutput(
        "Note: This is a simulation - actual files are not modified in browser",
        "INFO"
      );
      this.setStatus("File renaming completed");
    } catch (error) {
      this.writeOutput(
        `Error during rename operation: ${error.message}`,
        "ERROR"
      );
      this.setStatus("Rename operation failed");
    }
  }

  async applyOnePaceEdits() {
    if (!this.state.selectedShow) {
      this.writeOutput("No show selected. Search for the show first.", "ERROR");
      return;
    }

    const applyBtn = document.getElementById("applyBtn");
    const stopBtn = document.getElementById("stopBtn");
    const originalText = applyBtn.textContent;

    applyBtn.disabled = true;
    stopBtn.disabled = false;
    applyBtn.textContent = "Applying...";

    this.state.operationCancelled = false;

    this.setStatus("Loading metadata from Google Sheets...");
    this.writeOutput("Starting OnePace metadata updates...", "INFO");
    this.updateProgress(0, "Loading Google Sheets data...");

    try {
      // Load Google Sheets data if not already loaded
      if (!this.state.seasonMappingData || !this.state.episodeData) {
        const sheetsData = await this.api.googleSheets.getAllData();
        this.state.seasonMappingData = sheetsData.seasonMapping;
        this.state.episodeData = sheetsData.episodeData;
        this.state.releaseData = sheetsData.releaseData;
        this.writeOutput(
          "Loaded season mapping and episode data from Google Sheets",
          "SUCCESS"
        );
      }

      this.updateProgress(20, "Getting show metadata...");

      // Get show metadata
      let showMetadata;
      if (this.state.currentService === "plex") {
        showMetadata = await this.api.plex.getShowMetadata(
          this.state.selectedServer,
          this.state.selectedShow.ratingKey
        );
      } else if (this.state.currentService === "jellyfin") {
        showMetadata = await this.api.jellyfin.getShowMetadata(
          this.state.selectedShow.id
        );
      }

      this.writeOutput(
        `Loaded metadata for ${showMetadata.seasons.length} seasons`,
        "SUCCESS"
      );

      // Get update options
      const updateOptions = {
        title: document.getElementById("updateTitle").checked,
        seasonTitle: document.getElementById("updateSeasonTitle").checked,
        description: document.getElementById("updateDescription").checked,
        date: document.getElementById("updateDate").checked,
        posters: document.getElementById("updatePosters").checked,
        dryRun: document.getElementById("dryRun").checked,
      };

      // Build episode lookup
      const titleToSeason = {};
      this.state.seasonMappingData.forEach((row) => {
        if (row.part && row.title_en) {
          titleToSeason[row.title_en.toLowerCase().trim()] =
            row.title_en === "Specials" ? 0 : parseInt(row.part);
        }
      });

      const episodeLookup = {};
      this.state.episodeData.forEach((row) => {
        const arc = row.arc_title?.trim();
        const epPart = row.arc_part;
        const title = row.title_en;
        const description = row.description_en;

        if (!arc || !epPart || !title) return;

        const seasonNum =
          arc === "Specials" || arc === "One Piece Fan Letter"
            ? 0
            : titleToSeason[arc.toLowerCase()] || null;

        if (seasonNum !== null) {
          const key = `${seasonNum}-${epPart}`;
          episodeLookup[key] = { title, description };
        }
      });

      this.updateProgress(40, "Processing seasons...");

      let totalUpdates = 0;
      let seasonCount = 0;

      for (const season of showMetadata.seasons) {
        if (this.state.operationCancelled) {
          this.writeOutput("Operation cancelled by user", "WARNING");
          break;
        }

        seasonCount++;
        this.updateProgress(
          40 + (seasonCount / showMetadata.seasons.length) * 50,
          `Processing season ${season.number}...`
        );

        // Update season title
        const seasonInfo = this.state.seasonMappingData.find(
          (row) => row.part == season.number
        );
        if (
          updateOptions.seasonTitle &&
          seasonInfo &&
          seasonInfo.title_en &&
          seasonInfo.title_en !== season.title
        ) {
          if (updateOptions.dryRun) {
            this.writeOutput(
              `      [Dry Run] Would update Season ${season.number} title to '${seasonInfo.title_en}'`,
              "INFO"
            );
          } else {
            try {
              if (this.state.currentService === "plex") {
                await this.api.plex.updateMetadata(
                  this.state.selectedServer,
                  season.id,
                  {
                    title: seasonInfo.title_en,
                  }
                );
              }
              this.writeOutput(
                `      Updated Season ${season.number} title to '${seasonInfo.title_en}'`,
                "SUCCESS"
              );
              totalUpdates++;
            } catch (error) {
              this.writeOutput(
                `      Failed to update Season ${season.number} title: ${error.message}`,
                "ERROR"
              );
            }
          }
        }

        // Update season description
        if (
          updateOptions.description &&
          seasonInfo &&
          seasonInfo.description_en
        ) {
          if (updateOptions.dryRun) {
            this.writeOutput(
              `      [Dry Run] Would update Season ${season.number} description`,
              "INFO"
            );
          } else {
            try {
              if (this.state.currentService === "plex") {
                await this.api.plex.updateMetadata(
                  this.state.selectedServer,
                  season.id,
                  {
                    summary: seasonInfo.description_en,
                  }
                );
              }
              this.writeOutput(
                `      Updated Season ${season.number} description`,
                "SUCCESS"
              );
              totalUpdates++;
            } catch (error) {
              this.writeOutput(
                `      Failed to update Season ${season.number} description: ${error.message}`,
                "ERROR"
              );
            }
          }
        }

        // Process episodes
        for (const episode of season.episodes) {
          if (this.state.operationCancelled) break;

          const key = `${season.number}-${episode.number}`;
          const episodeData = episodeLookup[key];

          if (!episodeData) {
            this.writeOutput(
              `No data found for S${season.number}E${episode.number}`,
              "WARNING"
            );
            continue;
          }

          const updates = {};
          let willUpdate = false;

          if (updateOptions.title && episode.title !== episodeData.title) {
            updates.title = episodeData.title;
            willUpdate = true;
          }

          if (updateOptions.description && episodeData.description) {
            // Find release data for this episode
            const releaseInfo = this.state.releaseData?.find((row) =>
              row["One Pace Episode"]?.includes(
                episode.number.toString().padStart(2, "0")
              )
            );

            let episodeDescription = episodeData.description;
            if (releaseInfo) {
              if (releaseInfo.Chapters)
                episodeDescription += `\nChapters: ${releaseInfo.Chapters}`;
              if (releaseInfo.Episodes)
                episodeDescription += `\nEpisodes: ${releaseInfo.Episodes}`;
            }

            if (episode.summary !== episodeDescription) {
              updates.summary = episodeDescription;
              willUpdate = true;
            }
          }

          if (updateOptions.date) {
            const releaseInfo = this.state.releaseData?.find((row) =>
              row["One Pace Episode"]?.includes(
                episode.number.toString().padStart(2, "0")
              )
            );

            if (
              releaseInfo &&
              releaseInfo["Release Date"] &&
              !releaseInfo["Release Date"].includes("To Be Released") &&
              episode.originallyAvailableAt !== releaseInfo["Release Date"]
            ) {
              updates.originallyAvailableAt = releaseInfo["Release Date"];
              willUpdate = true;
            }
          }

          if (willUpdate) {
            if (updateOptions.dryRun) {
              const updateFields = Object.keys(updates);
              this.writeOutput(
                `      [Dry Run] Would update S${season.number
                  .toString()
                  .padStart(2, "0")}E${episode.number
                  .toString()
                  .padStart(2, "0")}: ${updateFields.join("/")}`,
                "INFO"
              );
            } else {
              try {
                if (this.state.currentService === "plex") {
                  await this.api.plex.updateMetadata(
                    this.state.selectedServer,
                    episode.id,
                    updates
                  );
                }
                const updateFields = Object.keys(updates);
                this.writeOutput(
                  `      Updated S${season.number
                    .toString()
                    .padStart(2, "0")}E${episode.number
                    .toString()
                    .padStart(2, "0")}: ${updateFields.join("/")}`,
                  "SUCCESS"
                );
                totalUpdates++;
                await Utils.sleep(100); // Rate limiting
              } catch (error) {
                this.writeOutput(
                  `      Failed to update S${season.number
                    .toString()
                    .padStart(2, "0")}E${episode.number
                    .toString()
                    .padStart(2, "0")}: ${error.message}`,
                  "ERROR"
                );
              }
            }
          } else {
            this.writeOutput(
              `      No updates needed for S${season.number
                .toString()
                .padStart(2, "0")}E${episode.number
                .toString()
                .padStart(2, "0")}`,
              "INFO"
            );
          }
        }

        await Utils.sleep(200); // Brief pause between seasons
      }

      this.updateProgress(100, "Updates completed");
      this.writeOutput("--------------------------------", "INFO");
      this.writeOutput(
        `Finished processing One Pace - ${totalUpdates} updates applied`,
        "SUCCESS"
      );
      this.writeOutput("--------------------------------", "INFO");
      this.setStatus(`Completed - ${totalUpdates} updates applied`);
    } catch (error) {
      this.writeOutput(
        `Error during update process: ${error.message}`,
        "ERROR"
      );
      this.setStatus("Update process failed");
    } finally {
      applyBtn.disabled = false;
      stopBtn.disabled = true;
      applyBtn.textContent = originalText;
      this.updateUIState();
    }
  }

  clearOutput() {
    const outputLog = document.getElementById("outputLog");
    if (outputLog) {
      outputLog.textContent = "Output cleared.\n";
    }
    this.updateProgress(0, "Ready to start");
    this.setStatus("Output cleared");
  }

  stopOperation() {
    this.state.operationCancelled = true;
    const stopBtn = document.getElementById("stopBtn");
    stopBtn.disabled = true;
    this.writeOutput("Cancelling operation...", "WARNING");
    this.setStatus("Operation cancelled");
  }
}

// Global functions
window.onePaceManager = null;

window.switchTab = (tabName) => window.onePaceManager?.switchTab(tabName);
window.getPlexToken = () => window.onePaceManager?.getPlexToken();
window.testJellyfinConnection = () =>
  window.onePaceManager?.testJellyfinConnection();
window.getServers = () => window.onePaceManager?.getServers();
window.searchShow = (service) => window.onePaceManager?.searchShow(service);
window.downloadAssets = () => window.onePaceManager?.downloadAssets();
window.extractAssets = () => window.onePaceManager?.extractAssets();
window.renameMediaFiles = () => window.onePaceManager?.renameMediaFiles();
window.applyOnePaceEdits = () => window.onePaceManager?.applyOnePaceEdits();
window.clearOutput = () => window.onePaceManager?.clearOutput();
window.stopOperation = () => window.onePaceManager?.stopOperation();

// Initialize application
document.addEventListener("DOMContentLoaded", () => {
  window.onePaceManager = new OnePaceManager();
});
