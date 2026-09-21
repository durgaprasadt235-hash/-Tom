// Search Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'elasticsearch',
    name: 'Elasticsearch',
    vendor: 'Elastic',
    category: 'search',
    description: 'Search and analytics engine',
    icon: ' Elasticsearch',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'index.read', description: 'Read index metadata', riskLevel: 'read', executable: false },
      { name: 'search.execute', description: 'Execute search queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token', 'basic'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'opensearch',
    name: 'OpenSearch',
    vendor: 'AWS',
    category: 'search',
    description: 'Open-source search and analytics suite',
    icon: ' OpenSearch',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'index.read', description: 'Read index metadata', riskLevel: 'read', executable: false },
      { name: 'search.execute', description: 'Execute search queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token', 'basic', 'iam'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'algolia',
    name: 'Algolia',
    vendor: 'Algolia',
    category: 'search',
    description: 'Search-as-a-service platform',
    icon: ' Algolia',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'index.read', description: 'Read index metadata', riskLevel: 'read', executable: false },
      { name: 'search.execute', description: 'Execute search queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];