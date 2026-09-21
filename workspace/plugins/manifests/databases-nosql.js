// NoSQL Database Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'mongodb',
    name: 'MongoDB',
    vendor: 'MongoDB Inc.',
    category: 'databases',
    description: 'Document-oriented NoSQL database',
    icon: ' MongoDB',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'collection.read', description: 'Read collection schema', riskLevel: 'read', executable: false },
      { name: 'query.execute', description: 'Execute read queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['password', 'certificate'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'dynamodb',
    name: 'DynamoDB',
    vendor: 'Amazon',
    category: 'databases',
    description: 'Serverless NoSQL database service',
    icon: ' DynamoDB',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'table.read', description: 'Read table metadata', riskLevel: 'read', executable: false },
      { name: 'item.read', description: 'Read item data', riskLevel: 'read', executable: false },
      { name: 'query.execute', description: 'Execute queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['iam', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'cassandra',
    name: 'Cassandra',
    vendor: 'Apache',
    category: 'databases',
    description: 'Distributed NoSQL database for large-scale data',
    icon: ' Cassandra',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'keyspace.read', description: 'Read keyspace metadata', riskLevel: 'read', executable: false },
      { name: 'table.read', description: 'Read table schema', riskLevel: 'read', executable: false },
      { name: 'query.execute', description: 'Execute read queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['password'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'cosmos-db',
    name: 'Cosmos DB',
    vendor: 'Microsoft',
    category: 'databases',
    description: 'Globally distributed multi-model database',
    icon: ' Cosmos',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'container.read', description: 'Read container schema', riskLevel: 'read', executable: false },
      { name: 'item.read', description: 'Read item data', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'couchbase',
    name: 'Couchbase',
    vendor: 'Couchbase',
    category: 'databases',
    description: 'Distributed document database with caching',
    icon: ' Couchbase',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'bucket.read', description: 'Read bucket metadata', riskLevel: 'read', executable: false },
      { name: 'collection.read', description: 'Read collection schema', riskLevel: 'read', executable: false },
      { name: 'query.execute', description: 'Execute N1QL queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['password'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'firestore',
    name: 'Firestore',
    vendor: 'Google',
    category: 'databases',
    description: 'Flexible NoSQL cloud database',
    icon: ' Firestore',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'collection.read', description: 'Read collection metadata', riskLevel: 'read', executable: false },
      { name: 'document.read', description: 'Read document data', riskLevel: 'read', executable: false },
      { name: 'query.execute', description: 'Execute queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];