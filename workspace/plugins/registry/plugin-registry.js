// Plugin Registry
// Loads and manages the plugin catalog from manifest files
// Catalog metadata only - no executable handlers

const path = require('path');
const fs = require('fs');

const MANIFESTS_DIR = path.join(__dirname, '..', 'manifests');

// Category manifest files to load
const CATEGORY_FILES = [
  'development.js',
  'source-control.js',
  'project-management.js',
  'documentation.js',
  'communication.js',
  'cloud.js',
  'infrastructure.js',
  'containers.js',
  'cicd.js',
  'deployment.js',
  'databases.js',
  'databases-managed.js',
  'databases-nosql.js',
  'cache.js',
  'warehouse.js',
  'data-platforms.js',
  'integration.js',
  'streaming.js',
  'observability.js',
  'security.js',
  'testing.js',
  'api-testing.js',
  'ai-ml.js',
  'ai-ml-part2.js',
  'design.js',
  'enterprise.js',
  'commerce.js',
  'search.js',
  'feature-management.js',
  'edge-dns.js',
  'package.js',
  'package-artifacts.js',
  'package-cloud.js'
];

const CATEGORY_MAP = {
  development: 'development',
  'source-control': 'source-control',
  'project-management': 'project-management',
  documentation: 'documentation',
  communication: 'communication',
  cloud: 'cloud',
  infrastructure: 'infrastructure',
  containers: 'containers',
  cicd: 'cicd',
  deployment: 'deployment',
  databases: 'databases',
  'databases-managed': 'databases',
  'databases-nosql': 'databases',
  cache: 'databases',
  warehouse: 'databases',
  'data-platforms': 'data-platforms',
  integration: 'integration',
  streaming: 'streaming',
  observability: 'observability',
  security: 'security',
  testing: 'testing',
  'api-testing': 'testing',
  'ai-ml': 'ai-ml',
  'ai-ml-part2': 'ai-ml',
  design: 'design',
  enterprise: 'enterprise',
  commerce: 'commerce',
  search: 'search',
  'feature-management': 'feature-management',
  'edge-dns': 'edge',
  package: 'package',
  'package-artifacts': 'package',
  'package-cloud': 'package'
};

/**
 * Load all plugin manifests from the manifests directory
 * @returns {Array} Array of all plugin objects
 */
function loadAllPlugins() {
  const allPlugins = [];
  
  for (const categoryFile of CATEGORY_FILES) {
    const filePath = path.join(MANIFESTS_DIR, categoryFile);
    
    if (!fs.existsSync(filePath)) {
      continue;
    }
    
    try {
      const plugins = require(filePath);
      if (Array.isArray(plugins)) {
        allPlugins.push(...plugins);
      }
    } catch (error) {
      console.error(`Error loading manifest ${categoryFile}:`, error.message);
    }
  }
  
  return allPlugins;
}

/**
 * Get the full plugin catalog
 * @returns {Array} Array of all plugin objects
 */
function getCatalog() {
  return loadAllPlugins();
}

/**
 * Get plugins by category
 * @param {string} category - Category name
 * @returns {Array} Array of plugins in the category
 */
function getPluginsByCategory(category) {
  const catalog = getCatalog();
  return catalog.filter(p => p.category === category);
}

/**
 * Get all available categories
 * @returns {Array} Array of unique category names
 */
function getCategories() {
  const catalog = getCatalog();
  const categories = new Set();
  catalog.forEach(p => categories.add(p.category));
  return Array.from(categories).sort();
}

/**
 * Get a single plugin by ID
 * @param {string} pluginId - Plugin ID
 * @returns {Object|null} Plugin object or null if not found
 */
function getPluginById(pluginId) {
  const catalog = getCatalog();
  return catalog.find(p => p.id === pluginId) || null;
}

/**
 * Search plugins by name, description, or vendor
 * @param {string} query - Search query
 * @returns {Array} Array of matching plugins
 */
function searchPlugins(query) {
  if (!query || query.trim() === '') {
    return getCatalog();
  }
  
  const lowerQuery = query.toLowerCase().trim();
  const catalog = getCatalog();
  
  return catalog.filter(plugin => {
    const searchableText = [
      plugin.name,
      plugin.description,
      plugin.vendor,
      plugin.category,
      ...plugin.capabilities.map(c => c.name)
    ].join(' ').toLowerCase();
    
    return searchableText.includes(lowerQuery);
  });
}

/**
 * Validate that a plugin ID exists in the catalog
 * @param {string} pluginId - Plugin ID to validate
 * @returns {boolean} True if plugin exists
 */
function validatePluginId(pluginId) {
  return getPluginById(pluginId) !== null;
}

module.exports = {
  loadAllPlugins,
  getCatalog,
  getPluginsByCategory,
  getCategories,
  getPluginById,
  searchPlugins,
  validatePluginId,
  CATEGORY_MAP
};