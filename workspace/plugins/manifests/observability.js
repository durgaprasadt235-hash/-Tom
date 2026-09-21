// Observability Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'datadog',
    name: 'Datadog',
    vendor: 'Datadog',
    category: 'observability',
    description: 'Monitoring and analytics platform for cloud-scale applications',
    icon: ' Datadog',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'metric.read', description: 'Read metric data', riskLevel: 'read', executable: false },
      { name: 'log.read', description: 'Read log data', riskLevel: 'read', executable: false },
      { name: 'dashboard.read', description: 'Read dashboard configuration', riskLevel: 'read', executable: false },
      { name: 'monitor.read', description: 'Read monitor configuration', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'new-relic',
    name: 'New Relic',
    vendor: 'New Relic',
    category: 'observability',
    description: 'Observability platform for developers',
    icon: ' New Relic',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'metric.read', description: 'Read metric data', riskLevel: 'read', executable: false },
      { name: 'trace.read', description: 'Read trace data', riskLevel: 'read', executable: false },
      { name: 'apm.read', description: 'Read APM data', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'dynatrace',
    name: 'Dynatrace',
    vendor: 'Dynatrace',
    category: 'observability',
    description: 'AI-powered observability and security platform',
    icon: ' Dynatrace',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'metric.read', description: 'Read metric data', riskLevel: 'read', executable: false },
      { name: 'problem.read', description: 'Read problem data', riskLevel: 'read', executable: false },
      { name: 'host.read', description: 'Read host information', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'grafana',
    name: 'Grafana',
    vendor: 'Grafana Labs',
    category: 'observability',
    description: 'Analytics and interactive visualization platform',
    icon: ' Grafana',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'dashboard.read', description: 'Read dashboard configuration', riskLevel: 'read', executable: false },
      { name: 'panel.read', description: 'Read panel data', riskLevel: 'read', executable: false },
      { name: 'datasource.read', description: 'Read datasource metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token', 'basic'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'prometheus',
    name: 'Prometheus',
    vendor: 'CNCF',
    category: 'observability',
    description: 'Open-source monitoring and alerting toolkit',
    icon: ' Prometheus',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'metric.read', description: 'Read metric data', riskLevel: 'read', executable: false },
      { name: 'target.read', description: 'Read scrape target info', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['none', 'basic'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];