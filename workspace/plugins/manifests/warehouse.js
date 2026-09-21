// Warehouse / Analytics Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'snowflake',
    name: 'Snowflake',
    vendor: 'Snowflake Inc.',
    category: 'databases',
    description: 'Cloud data warehouse with separation of storage and compute',
    icon: ' Snowflake',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'schema.read', description: 'Read schema metadata', riskLevel: 'read', executable: false },
      { name: 'table.read', description: 'Read table metadata', riskLevel: 'read', executable: false },
      { name: 'query.execute', description: 'Execute SQL queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['oauth', 'key', 'password'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'bigquery',
    name: 'BigQuery',
    vendor: 'Google',
    category: 'databases',
    description: 'Serverless data warehouse for analytics',
    icon: ' BigQuery',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'dataset.read', description: 'Read dataset metadata', riskLevel: 'read', executable: false },
      { name: 'table.read', description: 'Read table schema', riskLevel: 'read', executable: false },
      { name: 'query.execute', description: 'Execute SQL queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['oauth', 'service_account'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'redshift',
    name: 'Amazon Redshift',
    vendor: 'Amazon',
    category: 'databases',
    description: 'Cloud data warehouse service',
    icon: ' Redshift',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'table.read', description: 'Read table schema', riskLevel: 'read', executable: false },
      { name: 'query.execute', description: 'Execute SQL queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['iam', 'password'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'azure-synapse',
    name: 'Azure Synapse',
    vendor: 'Microsoft',
    category: 'databases',
    description: 'Analytics service with data warehouse and big data',
    icon: ' Synapse',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'table.read', description: 'Read table schema', riskLevel: 'read', executable: false },
      { name: 'query.execute', description: 'Execute SQL queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];