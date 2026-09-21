// API / Testing Plugins - Part 1
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'postman',
    name: 'Postman',
    vendor: 'Postman',
    category: 'testing',
    description: 'API platform for building and testing APIs',
    icon: ' Postman',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'collection.read', description: 'Read collection metadata', riskLevel: 'read', executable: false },
      { name: 'request.read', description: 'Read request details', riskLevel: 'read', executable: false },
      { name: 'request.execute', description: 'Execute API request', riskLevel: 'execute', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token', 'oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'insomnia',
    name: 'Insomnia',
    vendor: 'Insomnia',
    category: 'testing',
    description: 'API client for testing and debugging',
    icon: ' Insomnia',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'collection.read', description: 'Read collection metadata', riskLevel: 'read', executable: false },
      { name: 'request.execute', description: 'Execute API request', riskLevel: 'execute', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'swagger',
    name: 'Swagger/OpenAPI',
    vendor: 'SmartBear',
    category: 'testing',
    description: 'API documentation and testing framework',
    icon: ' Swagger',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'spec.read', description: 'Read API specification', riskLevel: 'read', executable: false },
      { name: 'endpoint.read', description: 'Read endpoint details', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['none', 'oauth', 'api_key'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'playwright',
    name: 'Playwright',
    vendor: 'Microsoft',
    category: 'testing',
    description: 'Web testing and automation framework',
    icon: ' Playwright',
    connectionType: 'cli',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'test.read', description: 'Read test metadata', riskLevel: 'read', executable: false },
      { name: 'test.execute', description: 'Run test execution', riskLevel: 'execute', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['none'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];