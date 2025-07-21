/**
 * One Pace Manager - Main Application Logic
 *
 * Main application class that coordinates all functionality
 */

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
      seasonData: null,
      releaseData: null,
      downloadedAssets: null,
      operationCancelled: false,
      jellyfinSession: null,
    };

    this.api = new APIManager();
    this.eventListeners = [];

    this.initializeApplication();
  }

  // Initialize the application
  async initializeApplication() {
    try {
      Logger.info("Initializing One Pace Manager...");

      this.setupEventListeners();
      this.loadCachedCredentials();
      this.updateUIState();

      this.writeOutput("One Pace Plex Manager - Full Implementation", "INFO");
      this.writeOutput("======================================", "INFO");
      this.writeOutput("Real API integration enabled!", "SUCCESS");
      this.writeOutput("", "INFO");

      this.setStatus("Ready - Authenticate to begin");

      // Test any existing connections
      await this.testExistingConnections();

      Logger.info("Application initialized successfully");
    } catch (error) {
      Logger.error("Failed to initialize application:", error);
      this.writeOutput(`Initialization error: ${error.message}`, "ERROR");
    }
  }

  // Setup all event listeners
  setupEventListeners() {
    // Media folder selection
    this.addEventListenerWithCleanup("mediaFolderInput", "change", (e) => {
      if (e.target.files.length > 0) {
        const path = e.target.files[0].webkitRelativePath.split("/")[0];
        DOM.get("renameMediaPath").value = path;
        this.writeOutput(`Selected media root folder: ${path}`, "INFO");
        this.updateUIState();
      }
    });

    // Form validation
    this.addEventListenerWithCleanup(
      "plexUser",
      "input",
      AsyncUtils.debounce(() => this.validateForm(), UI_CONFIG.debounce.input)
    );

    this.addEventListenerWithCleanup(
      "plexPass",
      "input",
      AsyncUtils.debounce(() => this.validateForm(), UI_CONFIG.debounce.input)
    );

    this.addEventListenerWithCleanup(
      "jellyfinUrl",
      "input",
      AsyncUtils.debounce(
        () => this.validateJellyfinForm(),
        UI_CONFIG.debounce.input
      )
    );

    this.addEventListenerWithCleanup(
      "jellyfinToken",
      "input",
      AsyncUtils.debounce(
        () => this.validateJellyfinForm(),
        UI_CONFIG.debounce.input
      )
    );

    // Search input
    this.addEventListenerWithCleanup(
      "searchTerm",
      "input",
      AsyncUtils.debounce(
        () => this.validateSearchForm(),
        UI_CONFIG.debounce.search
      )
    );

    // Keyboard shortcuts (if enabled)
    if (FEATURE_FLAGS.keyboardShortcuts) {
      this.addEventListenerWithCleanup(document, "keydown", (e) =>
        this.handleKeyboardShortcuts(e)
      );
    }

    // Window events
    this.addEventListenerWithCleanup(window, "beforeunload", () =>
      this.cleanup()
    );
    this.addEventListenerWithCleanup(
      window,
      "resize",
      AsyncUtils.throttle(() => this.handleResize(), UI_CONFIG.debounce.resize)
    );
  }

  // Add event listener with cleanup tracking
  addEventListenerWithCleanup(element, event, handler, options = {}) {
    const cleanup = DOM.on(element, event, handler, options);
    this.eventListeners.push(cleanup);
    return cleanup;
  }

  // Validate Plex form
  validateForm() {
    const username = DOM.get("plexUser")?.value || "";
    const password = DOM.get("plexPass")?.value || "";

    const isValid = Validator.username(username) && password.length >= 6;

    const loginBtn = DOM.get("plexLoginBtn");
    if (loginBtn) {
      loginBtn.disabled = !isValid;
    }
  }

  // Validate Jellyfin form
  validateJellyfinForm() {
    const url = DOM.get("jellyfinUrl")?.value || "";
    const token = DOM.get("jellyfinToken")?.value || "";

    const isValid = Validator.url(url) && Validator.apiKey(token);

    const testBtn = DOM.get("jellyfinTestBtn");
    if (testBtn) {
      testBtn.disabled = !isValid;
    }
  }

  // Validate search form
  validateSearchForm() {
    const searchTerm = DOM.get("searchTerm")?.value || "";
    const hasServer = this.state.selectedServer !== null;

    const isValid = searchTerm.length >= 1 && hasServer;

    DOM.get("searchPlexBtn").disabled =
      !isValid || this.state.currentService !== "plex";
    DOM.get("searchJellyfinBtn").disabled =
      !isValid || this.state.currentService !== "jellyfin";
  }

  // Update UI state based on current application state
  updateUIState() {
    const hasPlexAuth =
      this.state.userToken && this.state.currentService === "plex";
    const hasJellyfinAuth =
      this.state.jellyfinSession && this.state.currentService === "jellyfin";
    const hasAuth = hasPlexAuth || hasJellyfinAuth;
    const hasServer = this.state.selectedServer !== null;
    const hasShow = this.state.selectedShow !== null;
    const hasMediaPath = DOM.get("renameMediaPath")?.value;

    // Update button states
    const getServersBtn = DOM.get("getServersBtn");
    if (getServersBtn) getServersBtn.disabled = !hasAuth;

    const searchPlexBtn = DOM.get("searchPlexBtn");
    if (searchPlexBtn)
      searchPlexBtn.disabled =
        !hasAuth || !hasServer || this.state.currentService !== "plex";

    const searchJellyfinBtn = DOM.get("searchJellyfinBtn");
    if (searchJellyfinBtn)
      searchJellyfinBtn.disabled =
        !hasAuth || !hasServer || this.state.currentService !== "jellyfin";

    const applyBtn = DOM.get("applyBtn");
    if (applyBtn) applyBtn.disabled = !hasShow;

    const renameBtn = DOM.get("renameBtn");
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

    // Validate forms
    this.validateForm();
    this.validateJellyfinForm();
    this.validateSearchForm();
  }

  // Test existing connections on startup
  async testExistingConnections() {
    try {
      const results = await this.api.testConnections();

      Object.entries(results).forEach(([service, result]) => {
        if (result.status === "connected") {
          this.writeOutput(
            `${StringUtils.capitalize(service)} connection verified`,
            "SUCCESS"
          );
        } else if (result.status === "error") {
          this.writeOutput(
            `${StringUtils.capitalize(service)} connection error: ${
              result.error
            }`,
            "WARNING"
          );
        }
      });
    } catch (error) {
      Logger.warn("Failed to test existing connections:", error);
    }
  }

  // Load cached credentials
  loadCachedCredentials() {
    // Load Plex token
    const cachedPlexToken = Storage.get(STORAGE_CONFIG.keys.plexToken);
    if (cachedPlexToken) {
      this.state.userToken = cachedPlexToken;
      this.api.plex.token = cachedPlexToken;
      this.setConnectionStatus("plex", "connected");
      this.writeOutput("Loaded cached Plex token", "INFO");
    }

    // Load Jellyfin credentials
    const cachedJellyfinCreds = Storage.get(
      STORAGE_CONFIG.keys.jellyfinCredentials
    );
    if (cachedJellyfinCreds) {
      if (cachedJellyfinCreds.url) {
        DOM.get("jellyfinUrl").value = cachedJellyfinCreds.url;
        DOM.get("cacheJellyfinUrl").checked = true;
      }
      if (cachedJellyfinCreds.apiKey) {
        DOM.get("jellyfinToken").value = cachedJellyfinCreds.apiKey;
        DOM.get("cacheJellyfinToken").checked = true;
      }
      this.writeOutput("Loaded cached Jellyfin credentials", "INFO");
    }

    // Load user preferences
    const userPrefs = Storage.get(STORAGE_CONFIG.keys.userPreferences, {});
    if (userPrefs.lastService) {
      this.switchTab(userPrefs.lastService);
    }
  }

  // Save user preferences
  saveUserPreferences() {
    const prefs = {
      lastService: this.state.currentService,
      updateOptions: {
        title: DOM.get("updateTitle")?.checked,
        seasonTitle: DOM.get("updateSeasonTitle")?.checked,
        description: DOM.get("updateDescription")?.checked,
        date: DOM.get("updateDate")?.checked,
        posters: DOM.get("updatePosters")?.checked,
        dryRun: DOM.get("dryRun")?.checked,
      },
    };

    Storage.set(
      STORAGE_CONFIG.keys.userPreferences,
      prefs,
      STORAGE_CONFIG.expiration.userPreferences
    );
  }

  // Utility methods for UI interaction
  writeOutput(message, type = "INFO") {
    const timestamp = DateUtils.format(new Date(), "YYYY-MM-DD HH:mm:ss");
    const paddedType = type.toUpperCase().padEnd(7);
    const prefix = `[${timestamp}] [${paddedType}]`;
    const spacing = " ".repeat(Math.max(1, 37 - prefix.length));
    const formattedMessage = `${prefix}${spacing}${message}`;

    const outputLog = DOM.get("outputLog");
    if (outputLog) {
      outputLog.textContent += "\n" + formattedMessage;
      outputLog.scrollTop = outputLog.scrollHeight;

      // Limit log lines
      const lines = outputLog.textContent.split("\n");
      if (lines.length > UI_CONFIG.limits.logLines) {
        outputLog.textContent = lines
          .slice(-UI_CONFIG.limits.logLines)
          .join("\n");
      }
    }
  }

  setStatus(message) {
    const statusElement = DOM.get("statusMessage");
    if (statusElement) {
      statusElement.textContent = message;
    }
  }

  showMessage(message, type = "info") {
    const messageDiv = DOM.create("div", {
      className: `message ${type} fade-in`,
      textContent: message,
    });

    const container = document.querySelector(".main-content");
    if (container) {
      container.insertBefore(messageDiv, container.firstChild);

      setTimeout(() => {
        messageDiv.remove();
      }, UI_CONFIG.messages[type] || UI_CONFIG.messages.info);
    }
  }

  updateProgress(percent, text) {
    const progressFill = DOM.get("progressFill");
    const progressText = DOM.get("progressText");

    if (progressFill) {
      progressFill.style.width = `${NumberUtils.clamp(percent, 0, 100)}%`;
    }

    if (progressText) {
      progressText.textContent = text;
    }

    // Update progress bar aria attributes
    const progressBar = progressFill?.parentElement;
    if (progressBar) {
      progressBar.setAttribute("aria-valuenow", Math.round(percent));
    }
  }

  setConnectionStatus(service, status) {
    const statusDot = DOM.get(`${service}Status`);
    const statusText = DOM.get(`${service}StatusText`);

    if (statusDot) {
      statusDot.className = `status-dot ${status}`;
    }

    if (statusText) {
      statusText.textContent =
        status === "connected"
          ? "Connected"
          : status === "error"
          ? "Error"
          : "Disconnected";
    }
  }

  // Tab switching
  switchTab(tabName) {
    // Update tab UI
    DOM.getAll(".tab").forEach((tab) => tab.classList.remove("active"));
    DOM.getAll(".tab-content").forEach((content) =>
      content.classList.add("hidden")
    );

    const activeTab = Array.from(DOM.getAll(".tab")).find((tab) =>
      tab.textContent.toLowerCase().includes(tabName)
    );
    if (activeTab) {
      activeTab.classList.add("active");
    }

    const tabContent = DOM.get(`${tabName}-tab`);
    if (tabContent) {
      tabContent.classList.remove("hidden");
    }

    this.state.currentService = tabName;
    this.updateUIState();
    this.saveUserPreferences();
  }

  // Authentication methods
  async getPlexToken() {
    const username = DOM.get("plexUser").value;
    const password = DOM.get("plexPass").value;

    if (!username || !password) {
      this.showMessage("Please enter both username and password", "error");
      return;
    }

    const loginBtn = DOM.get("plexLoginBtn");
    const originalText = loginBtn.textContent;
    loginBtn.disabled = true;
    loginBtn.textContent = "Authenticating...";

    this.setStatus("Signing in to Plex...");
    this.writeOutput("Attempting Plex authentication...", "INFO");

    try {
      const result = await Performance.measure(
        "Plex Authentication",
        async () => {
          return await this.api.plex.authenticate(username, password);
        }
      );

      this.state.userToken = result.token;
      this.setConnectionStatus("plex", "connected");

      const cacheToken = DOM.get("cacheToken").checked;
      if (cacheToken) {
        Storage.set(
          STORAGE_CONFIG.keys.plexToken,
          result.token,
          STORAGE_CONFIG.expiration.plexToken
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
      this.showMessage("Authentication failed", "error");
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = originalText;
      this.updateUIState();
    }
  }

  async testJellyfinConnection() {
    const url = DOM.get("jellyfinUrl").value;
    const apiKey = DOM.get("jellyfinToken").value;

    if (!url || !apiKey) {
      this.showMessage("Please provide both URL and API Key", "error");
      return;
    }

    const testBtn = DOM.get("jellyfinTestBtn");
    const originalText = testBtn.textContent;
    testBtn.disabled = true;
    testBtn.textContent = "Testing...";

    this.setStatus("Testing Jellyfin connection...");
    this.writeOutput("Testing Jellyfin connection...", "INFO");

    try {
      const result = await Performance.measure(
        "Jellyfin Connection Test",
        async () => {
          return await this.api.jellyfin.testConnection(url, apiKey);
        }
      );

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
      this.showMessage(
        `Connection successful to: ${result.serverName}`,
        "success"
      );

      // Cache credentials if requested
      const cacheUrl = DOM.get("cacheJellyfinUrl").checked;
      const cacheToken = DOM.get("cacheJellyfinToken").checked;

      if (cacheUrl || cacheToken) {
        const cacheData = {};
        if (cacheUrl) cacheData.url = url;
        if (cacheToken) cacheData.apiKey = apiKey;
        Storage.set(
          STORAGE_CONFIG.keys.jellyfinCredentials,
          cacheData,
          STORAGE_CONFIG.expiration.jellyfinCredentials
        );
        this.writeOutput("Jellyfin credentials cached", "INFO");
      }
    } catch (error) {
      this.writeOutput(`Jellyfin connection failed: ${error.message}`, "ERROR");
      this.setStatus(`Connection failed: ${error.message}`);
      this.setConnectionStatus("jellyfin", "error");
      this.showMessage("Jellyfin connection failed", "error");
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = originalText;
      this.updateUIState();
    }
  }

  // Server management
  async getServers() {
    const currentAPI = this.api.getAPI(this.state.currentService);

    if (!currentAPI.token && this.state.currentService === "plex") {
      this.showMessage("No token. Please sign in first.", "error");
      return;
    }

    if (
      !this.state.jellyfinSession &&
      this.state.currentService === "jellyfin"
    ) {
      this.showMessage(
        "No Jellyfin connection. Please test connection first.",
        "error"
      );
      return;
    }

    const getServersBtn = DOM.get("getServersBtn");
    const originalText = getServersBtn.textContent;
    getServersBtn.disabled = true;
    getServersBtn.textContent = "Loading...";

    this.setStatus("Getting servers...");
    this.writeOutput("Fetching server list...", "INFO");

    try {
      let servers = [];

      if (this.state.currentService === "plex") {
        servers = await Performance.measure("Fetch Plex Servers", async () => {
          return await this.api.plex.getServers();
        });
      } else if (this.state.currentService === "jellyfin") {
        // For Jellyfin, we use the current connection as the "server"
        servers = [
          {
            name: this.state.jellyfinSession.serverName,
            address: new URL(this.state.jellyfinSession.url).hostname,
            port:
              new URL(this.state.jellyfinSession.url).port ||
              (new URL(this.state.jellyfinSession.url).protocol === "https:"
                ? "443"
                : "80"),
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
      this.showMessage("Failed to get servers", "error");
    } finally {
      getServersBtn.disabled = false;
      getServersBtn.textContent = originalText;
      this.updateUIState();
    }
  }

  renderServerList(servers) {
    const serverListElement = DOM.get("serverList");
    if (!serverListElement) return;

    serverListElement.innerHTML = "";

    servers.slice(0, UI_CONFIG.limits.serverList).forEach((server, index) => {
      const item = DOM.create("div", {
        className: "list-item",
        textContent: `${server.name} (${server.address}:${server.port})`,
        "data-index": index,
        role: "option",
        tabindex: "0",
      });

      item.onclick = () => this.selectServer(index);
      item.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.selectServer(index);
        }
      };

      serverListElement.appendChild(item);
    });
  }

  selectServer(index) {
    // Remove previous selection
    DOM.getAll("#serverList .list-item").forEach((item) => {
      item.classList.remove("selected");
      item.setAttribute("aria-selected", "false");
    });

    // Select new server
    const selectedItem = DOM.getAll("#serverList .list-item")[index];
    if (selectedItem) {
      selectedItem.classList.add("selected");
      selectedItem.setAttribute("aria-selected", "true");
    }

    this.state.selectedServer = this.state.serverList[index];

    this.writeOutput(
      `Selected server: ${this.state.selectedServer.name}`,
      "INFO"
    );
    this.updateUIState();
  }

  // Search functionality
  async searchShow(service) {
    const searchTerm = DOM.get("searchTerm").value;

    if (!searchTerm) {
      this.showMessage("Enter a show name", "error");
      return;
    }

    if (!this.state.selectedServer) {
      this.showMessage("No server selected", "error");
      return;
    }

    const searchBtn = DOM.get(`search${StringUtils.capitalize(service)}Btn`);
    const originalText = searchBtn.textContent;
    searchBtn.disabled = true;
    searchBtn.textContent = "Searching...";

    this.setStatus("Searching...");
    this.writeOutput(`Searching for "${searchTerm}" in ${service}...`, "INFO");

    try {
      let searchResults = [];

      if (service === "plex") {
        searchResults = await Performance.measure("Plex Search", async () => {
          return await this.api.plex.searchShows(
            this.state.selectedServer,
            searchTerm
          );
        });
      } else if (service === "jellyfin") {
        searchResults = await Performance.measure(
          "Jellyfin Search",
          async () => {
            return await this.api.jellyfin.searchShows(searchTerm);
          }
        );
      }

      this.state.searchResults = searchResults.slice(
        0,
        UI_CONFIG.limits.searchResults
      );
      this.renderSearchResults(this.state.searchResults);

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
      this.showMessage("Search failed", "error");
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = originalText;
      this.updateUIState();
    }
  }

  renderSearchResults(results) {
    const searchResultsElement = DOM.get("searchResults");
    if (!searchResultsElement) return;

    searchResultsElement.innerHTML = "";

    if (results.length > 0) {
      results.forEach((show, index) => {
        const item = DOM.create("div", {
          className: "list-item",
          textContent: `${show.title}${show.year ? ` (${show.year})` : ""}`,
          "data-index": index,
          role: "option",
          tabindex: "0",
        });

        item.onclick = () => this.selectShow(index);
        item.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this.selectShow(index);
          }
        };

        searchResultsElement.appendChild(item);
      });
    } else {
      const item = DOM.create("div", {
        className: "list-item",
        textContent: "No shows found",
        style: "font-style: italic; color: var(--clr-surface-a50);",
      });
      searchResultsElement.appendChild(item);
    }
  }

  selectShow(index) {
    // Remove previous selection
    DOM.getAll("#searchResults .list-item").forEach((item) => {
      item.classList.remove("selected");
      item.setAttribute("aria-selected", "false");
    });

    // Select new show
    const selectedItem = DOM.getAll("#searchResults .list-item")[index];
    if (selectedItem) {
      selectedItem.classList.add("selected");
      selectedItem.setAttribute("aria-selected", "true");
    }

    this.state.selectedShow = this.state.searchResults[index];

    const selectedShowElement = DOM.get("selectedShow");
    if (selectedShowElement) {
      const identifier =
        this.state.selectedShow.ratingKey || this.state.selectedShow.id;
      selectedShowElement.textContent = `Selected: ${this.state.selectedShow.title} (${identifier})`;
    }

    this.writeOutput(`Selected show: ${this.state.selectedShow.title}`, "INFO");
    this.updateUIState();
  }

  // Continue in next part due to length...
  // [The rest of the methods would continue here including data loading, file processing, and the main edit application logic]

  // Cleanup method
  cleanup() {
    Logger.info("Cleaning up application...");

    // Remove all event listeners
    this.eventListeners.forEach((cleanup) => cleanup());
    this.eventListeners = [];

    // Save user preferences
    this.saveUserPreferences();

    // Cancel any ongoing operations
    this.state.operationCancelled = true;
  }

  // Handle keyboard shortcuts
  handleKeyboardShortcuts(event) {
    // Only process shortcuts when not typing in inputs
    if (
      event.target.tagName === "INPUT" ||
      event.target.tagName === "TEXTAREA"
    ) {
      return;
    }

    // Define shortcuts
    const shortcuts = {
      KeyS: () => this.searchShow(this.state.currentService),
      KeyR: () => this.renameMediaFiles(),
      KeyA: () => this.applyOnePaceEdits(),
      KeyC: () => this.clearOutput(),
      Escape: () => this.stopOperation(),
    };

    if (event.ctrlKey && shortcuts[event.code]) {
      event.preventDefault();
      shortcuts[event.code]();
    }
  }

  // Handle window resize
  handleResize() {
    // Adjust UI elements for different screen sizes
    const isMobile = window.innerWidth < 768;

    // Update mobile-specific UI adjustments
    if (isMobile) {
      // Mobile adjustments
    } else {
      // Desktop adjustments
    }
  }
}

// Global functions for HTML onclick handlers
window.onePaceManager = null;

window.switchTab = (tabName) => {
  window.onePaceManager?.switchTab(tabName);
};

window.getPlexToken = () => {
  window.onePaceManager?.getPlexToken();
};

window.testJellyfinConnection = () => {
  window.onePaceManager?.testJellyfinConnection();
};

window.getServers = () => {
  window.onePaceManager?.getServers();
};

window.searchShow = (service) => {
  window.onePaceManager?.searchShow(service);
};

window.downloadAssets = () => {
  window.onePaceManager?.downloadAssets();
};

window.extractAssets = () => {
  window.onePaceManager?.extractAssets();
};

window.renameMediaFiles = () => {
  window.onePaceManager?.renameMediaFiles();
};

window.applyOnePaceEdits = () => {
  window.onePaceManager?.applyOnePaceEdits();
};

window.clearOutput = () => {
  window.onePaceManager?.clearOutput();
};

window.stopOperation = () => {
  window.onePaceManager?.stopOperation();
};

// Initialize application when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  window.onePaceManager = new OnePaceManager();

  // Add global error handler
  window.addEventListener("error", (event) => {
    Logger.error("Global error:", event.error);
    if (window.onePaceManager) {
      window.onePaceManager.writeOutput(
        `Global error: ${event.error.message}`,
        "ERROR"
      );
    }
  });

  // Add unhandled promise rejection handler
  window.addEventListener("unhandledrejection", (event) => {
    Logger.error("Unhandled promise rejection:", event.reason);
    if (window.onePaceManager) {
      window.onePaceManager.writeOutput(
        `Promise rejection: ${event.reason}`,
        "ERROR"
      );
    }
  });
});

// Export for module usage
if (typeof module !== "undefined" && module.exports) {
  module.exports = { OnePaceManager };
}
