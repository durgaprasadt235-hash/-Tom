// Communication Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'slack',
    name: 'Slack',
    vendor: 'Slack Technologies',
    category: 'communication',
    description: 'Business communication and team collaboration',
    icon: '💬',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'channel.read', description: 'Read channel information', riskLevel: 'read', executable: false },
      { name: 'message.read', description: 'Read message history', riskLevel: 'read', executable: false },
      { name: 'message.send', description: 'Send messages', riskLevel: 'write', executable: false },
      { name: 'user.read', description: 'Read user information', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'microsoft-teams',
    name: 'Microsoft Teams',
    vendor: 'Microsoft',
    category: 'communication',
    description: 'Team collaboration and communication platform',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'channel.read', description: 'Read channel information', riskLevel: 'read', executable: false },
      { name: 'message.read', description: 'Read message history', riskLevel: 'read', executable: false },
      { name: 'message.send', description: 'Send messages', riskLevel: 'write', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'gmail',
    name: 'Gmail',
    vendor: 'Google',
    category: 'communication',
    description: 'Email service with API access',
    icon: '✉',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'email.read', description: 'Read email messages', riskLevel: 'read', executable: false },
      { name: 'email.send', description: 'Send email messages', riskLevel: 'write', executable: false },
      { name: 'label.read', description: 'Read label information', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'outlook',
    name: 'Outlook',
    vendor: 'Microsoft',
    category: 'communication',
    description: 'Email and calendar service',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'email.read', description: 'Read email messages', riskLevel: 'read', executable: false },
      { name: 'email.send', description: 'Send email messages', riskLevel: 'write', executable: false },
      { name: 'calendar.read', description: 'Read calendar events', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];