/**
 * One Pace Manager - Configuration Constants
 *
 * Central configuration file for all API endpoints, settings, and constants
 */

// Application Configuration
const APP_CONFIG = {
  name: "One Pace Manager",
  version: "2.0.0",
  description:
    "Manage your One Pace collection with metadata updates and poster management",
  author: "One Pace Team",
  repository: "https://github.com/SpykerNZ/one-pace-for-plex",
  website: "https://onepace.net",
};

// API Configuration
const API_CONFIG = {
  // Plex Configuration
  plex: {
    signInUrl: "https://plex.tv/users/sign_in.xml",
    serversUrl: "https://plex.tv/pms/servers",
    headers: {
      "X-Plex-Version": "1.1.2",
      "X-Plex-Product": "OnePace",
      "X-Plex-Client-Identifier": "271938",
      "Content-Type": "application/xml",
    },
    timeout: 30000, // 30 seconds
  },

  // Jellyfin Configuration
  jellyfin: {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    endpoints: {
      systemInfo: "/System/Info/Public",
      users: "/Users",
      items: "/Users/{userId}/Items",
      seasons: "/Shows/{showId}/Seasons",
      episodes: "/Shows/{showId}/Episodes",
    },
    timeout: 30000, // 30 seconds
  },

  // Google Sheets Configuration
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
    timeout: 15000, // 15 seconds
  },

  // GitHub Assets Configuration
  github: {
    assetsUrl:
      "https://github.com/SpykerNZ/one-pace-for-plex/archive/refs/heads/main.zip",
    timeout: 60000, // 60 seconds for large downloads
  },

  // CORS Proxy Configuration
  corsProxy: {
    primary: "https://api.allorigins.win/raw?url=",
    fallback: "https://cors-anywhere.herokuapp.com/",
    timeout: 30000,
  },
};

// File Processing Configuration
const FILE_CONFIG = {
  videoExtensions: [
    ".mkv",
    ".mp4",
    ".avi",
    ".m4v",
    ".mov",
    ".wmv",
    ".flv",
    ".webm",
  ],
  imageExtensions: [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"],
  subtitleExtensions: [".srt", ".ass", ".ssa", ".vtt", ".sub"],

  // Filename patterns for One Pace
  patterns: {
    onePace:
      /\[(?<episodes>\d+(?:-\d+)?)\]\s+(?<arc>.+?)\s+(?<episode>\d{1,2})(?:\s+(?<title>.+?))?\./i,
    season: /S(?<season>\d{1,2})E(?<episode>\d{1,2})/i,
    generic: /(?<title>.+?)[\s\.](?<season>\d{1,2})x(?<episode>\d{1,2})/i,
  },

  // Naming conventions
  naming: {
    episode: "One Pace - S{season:00}E{episode:00} - {title}.{ext}",
    season: "season{season:00}-poster.png",
    show: "poster.png",
  },
};

// UI Configuration
const UI_CONFIG = {
  // Animation timings
  animations: {
    fast: 150,
    normal: 300,
    slow: 500,
  },

  // Debounce timings
  debounce: {
    search: 300,
    input: 500,
    resize: 250,
  },

  // Progress update intervals
  progress: {
    updateInterval: 100,
    smoothing: true,
  },

  // Message display durations
  messages: {
    info: 5000,
    success: 4000,
    warning: 6000,
    error: 8000,
  },

  // List limits
  limits: {
    searchResults: 50,
    serverList: 20,
    logLines: 1000,
  },
};

// Storage Configuration
const STORAGE_CONFIG = {
  keys: {
    plexToken: "onePace_plexToken",
    jellyfinCredentials: "onePace_jellyfinCredentials",
    userPreferences: "onePace_userPreferences",
    cachedSheetData: "onePace_cachedSheetData",
  },

  // Cache expiration times (milliseconds)
  expiration: {
    plexToken: 30 * 24 * 60 * 60 * 1000, // 30 days
    jellyfinCredentials: 30 * 24 * 60 * 60 * 1000, // 30 days
    sheetData: 24 * 60 * 60 * 1000, // 24 hours
    userPreferences: 365 * 24 * 60 * 60 * 1000, // 1 year
  },
};

// Error Configuration
const ERROR_CONFIG = {
  // Network error retry configuration
  retry: {
    maxAttempts: 3,
    baseDelay: 1000, // 1 second
    maxDelay: 10000, // 10 seconds
    backoffMultiplier: 2,
  },

  // Error message templates
  messages: {
    network: "Network error: {message}. Please check your connection.",
    auth: "Authentication failed: {message}. Please check your credentials.",
    server: "Server error: {message}. Please try again later.",
    parse: "Data parsing error: {message}. Please contact support.",
    permission:
      "Permission denied: {message}. Please check your access rights.",
    notFound: "Resource not found: {message}. Please verify the URL.",
    timeout: "Request timed out: {message}. Please try again.",
    generic: "An unexpected error occurred: {message}",
  },
};

// Development Configuration
const DEV_CONFIG = {
  // Debug settings
  debug: {
    enabled: false, // Set to true for development
    logLevel: "info", // 'debug', 'info', 'warn', 'error'
    apiLogging: true,
    performanceLogging: false,
  },

  // Mock data for testing
  mock: {
    enabled: false, // Set to true to use mock data
    servers: [
      { name: "Test Plex Server", address: "192.168.1.100", port: "32400" },
      {
        name: "Test Remote Server",
        address: "external.example.com",
        port: "32400",
      },
    ],
    shows: [
      { title: "One Pace", ratingKey: "12345", year: "2023" },
      { title: "One Piece", ratingKey: "67890", year: "1999" },
    ],
  },

  // Testing endpoints
  test: {
    apiDelay: 1000, // Simulate network delay
    errorRate: 0, // 0-1, chance of random errors
    cacheBust: false, // Add timestamp to URLs
  },
};

// Feature Flags
const FEATURE_FLAGS = {
  // Core features
  plexIntegration: true,
  jellyfinIntegration: true,
  googleSheetsIntegration: true,
  fileProcessing: true,
  posterManagement: true,

  // Advanced features
  bulkOperations: true,
  backgroundSync: false, // Future feature
  offlineMode: false, // Future feature
  pluginSystem: false, // Future feature

  // UI features
  darkMode: true,
  animations: true,
  tooltips: true,
  keyboardShortcuts: false, // Future feature
};

// Validation Rules
const VALIDATION_RULES = {
  // Input validation
  username: {
    minLength: 3,
    maxLength: 50,
    pattern: /^[a-zA-Z0-9._@-]+$/,
  },

  url: {
    pattern: /^https?:\/\/.+/,
    maxLength: 2048,
  },

  apiKey: {
    minLength: 10,
    maxLength: 200,
    pattern: /^[a-zA-Z0-9]+$/,
  },

  showName: {
    minLength: 1,
    maxLength: 100,
  },
};

// Export configuration (for use in other modules)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    APP_CONFIG,
    API_CONFIG,
    FILE_CONFIG,
    UI_CONFIG,
    STORAGE_CONFIG,
    ERROR_CONFIG,
    DEV_CONFIG,
    FEATURE_FLAGS,
    VALIDATION_RULES,
  };
}
