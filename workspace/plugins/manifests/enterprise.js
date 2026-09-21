// Enterprise / Business Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'salesforce',
    name: 'Salesforce',
    vendor: 'Salesforce',
    category: 'enterprise',
    description: 'Customer relationship management platform',
    icon: ' Salesforce',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'object.read', description: 'Read object data', riskLevel: 'read', executable: false },
      { name: 'record.read', description: 'Read record data', riskLevel: 'read', executable: false },
      { name: 'record.create', description: 'Create records', riskLevel: 'write', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    vendor: 'HubSpot',
    category: 'enterprise',
    description: 'CRM and marketing platform',
    icon: ' HubSpot',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'contact.read', description: 'Read contact data', riskLevel: 'read', executable: false },
      { name: 'company.read', description: 'Read company data', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'servicenow',
    name: 'ServiceNow',
    vendor: 'ServiceNow',
    category: 'enterprise',
    description: 'IT service management platform',
    icon: ' ServiceNow',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'incident.read', description: 'Read incident data', riskLevel: 'read', executable: false },
      { name: 'ticket.read', description: 'Read ticket data', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'basic'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'jira-service-management',
    name: 'Jira Service Management',
    vendor: 'Atlassian',
    category: 'enterprise',
    description: 'IT service management and customer support',
    icon: ' Jira',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'request.read', description: 'Read service request', riskLevel: 'read', executable: false },
      { name: 'request.create', description: 'Create service request', riskLevel: 'write', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'sap',
    name: 'SAP',
    vendor: 'SAP',
    category: 'enterprise',
    description: 'Enterprise resource planning software',
    icon: ' SAP',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'data.read', description: 'Read business data', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'oracle-enterprise',
    name: 'Oracle Enterprise Applications',
    vendor: 'Oracle',
    category: 'enterprise',
    description: 'Enterprise business software suite',
    icon: ' Oracle',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'data.read', description: 'Read business data', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];