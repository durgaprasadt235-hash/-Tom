// Streaming / Messaging Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'apache-kafka',
    name: 'Apache Kafka',
    vendor: 'Apache',
    category: 'streaming',
    description: 'Distributed event streaming platform',
    icon: '',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'topic.read', description: 'Read topic metadata', riskLevel: 'read', executable: false },
      { name: 'topic.list', description: 'List topics', riskLevel: 'read', executable: false },
      { name: 'consumer.group.read', description: 'Read consumer group status', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['none', 'sasl'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'confluent',
    name: 'Confluent',
    vendor: 'Confluent',
    category: 'streaming',
    description: 'Enterprise Kafka platform with managed services',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'topic.read', description: 'Read topic metadata', riskLevel: 'read', executable: false },
      { name: 'topic.list', description: 'List topics', riskLevel: 'read', executable: false },
      { name: 'cluster.read', description: 'Read cluster information', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'aws-kinesis',
    name: 'AWS Kinesis',
    vendor: 'Amazon',
    category: 'streaming',
    description: 'Real-time data streaming service',
    icon: ' Kinesis',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'stream.read', description: 'Read stream metadata', riskLevel: 'read', executable: false },
      { name: 'stream.list', description: 'List streams', riskLevel: 'read', executable: false },
      { name: 'record.read', description: 'Read stream records', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['iam', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'azure-event-hubs',
    name: 'Azure Event Hubs',
    vendor: 'Microsoft',
    category: 'streaming',
    description: 'Big data streaming platform',
    icon: ' Event Hubs',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'hub.read', description: 'Read hub metadata', riskLevel: 'read', executable: false },
      { name: 'hub.list', description: 'List event hubs', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'rabbitmq',
    name: 'RabbitMQ',
    vendor: 'RabbitMQ',
    category: 'streaming',
    description: 'Message broker for reliable messaging',
    icon: '',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'queue.read', description: 'Read queue metadata', riskLevel: 'read', executable: false },
      { name: 'queue.list', description: 'List queues', riskLevel: 'read', executable: false },
      { name: 'exchange.read', description: 'Read exchange metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['password'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'google-pubsub',
    name: 'Google Pub/Sub',
    vendor: 'Google',
    category: 'streaming',
    description: 'Messaging service for event ingestion and delivery',
    icon: ' Pub/Sub',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'topic.read', description: 'Read topic metadata', riskLevel: 'read', executable: false },
      { name: 'topic.list', description: 'List topics', riskLevel: 'read', executable: false },
      { name: 'subscription.read', description: 'Read subscription metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['oauth', 'service_account'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];