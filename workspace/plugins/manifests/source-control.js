// Source Control Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'git',
    name: 'Git',
    vendor: 'Git Foundation',
    category: 'source-control',
    description: 'Distributed version control system',
    icon: '🌿',
    connectionType: 'local',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'repository.read', description: 'Read repository information', riskLevel: 'read', executable: false },
      { name: 'branch.read', description: 'List repository branches', riskLevel: 'read', executable: false },
      { name: 'commit.read', description: 'Read commit history', riskLevel: 'read', executable: false },
      { name: 'pull_request.read', description: 'Read pull request information', riskLevel: 'read', executable: false },
      { name: 'issue.read', description: 'Read issue information', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['ssh', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'github',
    name: 'GitHub',
    vendor: 'Microsoft',
    category: 'source-control',
    description: 'Cloud-based Git repository hosting with CI/CD and collaboration',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'repository.read', description: 'Read repository metadata', riskLevel: 'read', executable: false },
      { name: 'branch.read', description: 'List branches', riskLevel: 'read', executable: false },
      { name: 'commit.read', description: 'Read commit history', riskLevel: 'read', executable: false },
      { name: 'pull_request.read', description: 'Read pull requests', riskLevel: 'read', executable: false },
      { name: 'issue.read', description: 'Read issues', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    vendor: 'GitLab',
    category: 'source-control',
    description: 'DevOps platform with Git repository management',
    icon: '�gitlab',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'repository.read', description: 'Read repository metadata', riskLevel: 'read', executable: false },
      { name: 'branch.read', description: 'List branches', riskLevel: 'read', executable: false },
      { name: 'commit.read', description: 'Read commit history', riskLevel: 'read', executable: false },
      { name: 'merge_request.read', description: 'Read merge requests', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'bitbucket',
    name: 'Bitbucket',
    vendor: 'Atlassian',
    category: 'source-control',
    description: 'Git repository management with CI/CD pipelines',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'repository.read', description: 'Read repository metadata', riskLevel: 'read', executable: false },
      { name: 'branch.read', description: 'List branches', riskLevel: 'read', executable: false },
      { name: 'pull_request.read', description: 'Read pull requests', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'azure-repos',
    name: 'Azure Repos',
    vendor: 'Microsoft',
    category: 'source-control',
    description: 'Git repositories in Azure DevOps',
    icon: '🅰',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'repository.read', description: 'Read repository metadata', riskLevel: 'read', executable: false },
      { name: 'branch.read', description: 'List branches', riskLevel: 'read', executable: false },
      { name: 'commit.read', description: 'Read commit history', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];