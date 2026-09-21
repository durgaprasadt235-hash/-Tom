// Project Management Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'jira',
    name: 'Jira',
    vendor: 'Atlassian',
    category: 'project-management',
    description: 'Issue tracking and project management',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'issue.read', description: 'Read issue details', riskLevel: 'read', executable: false },
      { name: 'issue.create', description: 'Create new issue', riskLevel: 'write', executable: false },
      { name: 'project.read', description: 'Read project metadata', riskLevel: 'read', executable: false },
      { name: 'board.read', description: 'Read board configuration', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'linear',
    name: 'Linear',
    vendor: 'Linear',
    category: 'project-management',
    description: 'Modern issue tracking for software teams',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'issue.read', description: 'Read issue details', riskLevel: 'read', executable: false },
      { name: 'issue.create', description: 'Create new issue', riskLevel: 'write', executable: false },
      { name: 'project.read', description: 'Read project metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'asana',
    name: 'Asana',
    vendor: 'Asana',
    category: 'project-management',
    description: 'Work management platform',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'task.read', description: 'Read task details', riskLevel: 'read', executable: false },
      { name: 'task.create', description: 'Create new task', riskLevel: 'write', executable: false },
      { name: 'project.read', description: 'Read project metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'trello',
    name: 'Trello',
    vendor: 'Atlassian',
    category: 'project-management',
    description: 'Visual collaboration tool using boards and cards',
    icon: '⚡',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'board.read', description: 'Read board contents', riskLevel: 'read', executable: false },
      { name: 'card.read', description: 'Read card details', riskLevel: 'read', executable: false },
      { name: 'card.create', description: 'Create new card', riskLevel: 'write', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'monday',
    name: 'Monday.com',
    vendor: 'monday.com',
    category: 'project-management',
    description: 'Work OS for project management and collaboration',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'item.read', description: 'Read item details', riskLevel: 'read', executable: false },
      { name: 'item.create', description: 'Create new item', riskLevel: 'write', executable: false },
      { name: 'board.read', description: 'Read board metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    vendor: 'ClickUp',
    category: 'project-management',
    description: 'All-in-one productivity platform',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'task.read', description: 'Read task details', riskLevel: 'read', executable: false },
      { name: 'task.create', description: 'Create new task', riskLevel: 'write', executable: false },
      { name: 'list.read', description: 'Read list metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'azure-boards',
    name: 'Azure Boards',
    vendor: 'Microsoft',
    category: 'project-management',
    description: 'Agile project management in Azure DevOps',
    icon: '🅰',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'work_item.read', description: 'Read work item details', riskLevel: 'read', executable: false },
      { name: 'work_item.create', description: 'Create new work item', riskLevel: 'write', executable: false },
      { name: 'project.read', description: 'Read project metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];