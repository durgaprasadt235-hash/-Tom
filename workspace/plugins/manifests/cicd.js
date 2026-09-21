// CI/CD Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'github-actions',
    name: 'GitHub Actions',
    vendor: 'Microsoft',
    category: 'cicd',
    description: 'CI/CD platform integrated with GitHub repositories',
    icon: '⚡',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'workflow.read', description: 'Read workflow configuration', riskLevel: 'read', executable: false },
      { name: 'workflow.run', description: 'Trigger workflow execution', riskLevel: 'execute', executable: false },
      { name: 'run.read', description: 'Read workflow run results', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'gitlab-ci',
    name: 'GitLab CI/CD',
    vendor: 'GitLab',
    category: 'cicd',
    description: 'Built-in CI/CD pipelines for GitLab repositories',
    icon: '� 예상대로',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'pipeline.read', description: 'Read pipeline metadata', riskLevel: 'read', executable: false },
      { name: 'pipeline.trigger', description: 'Trigger pipeline execution', riskLevel: 'execute', executable: false },
      { name: 'job.read', description: 'Read job status', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'jenkins',
    name: 'Jenkins',
    vendor: 'CloudBees',
    category: 'cicd',
    description: 'Open-source automation server for CI/CD',
    icon: '🔵',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'job.read', description: 'Read job configuration', riskLevel: 'read', executable: false },
      { name: 'job.trigger', description: 'Trigger job execution', riskLevel: 'execute', executable: false },
      { name: 'build.read', description: 'Read build results', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'azure-pipelines',
    name: 'Azure DevOps Pipelines',
    vendor: 'Microsoft',
    category: 'cicd',
    description: 'CI/CD pipelines in Azure DevOps',
    icon: '🅰',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'pipeline.read', description: 'Read pipeline metadata', riskLevel: 'read', executable: false },
      { name: 'pipeline.trigger', description: 'Trigger pipeline execution', riskLevel: 'execute', executable: false },
      { name: 'build.read', description: 'Read build results', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'circleci',
    name: 'CircleCI',
    vendor: 'CircleCI',
    category: 'cicd',
    description: 'Cloud-based CI/CD platform',
    icon: '⭕',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'pipeline.read', description: 'Read pipeline metadata', riskLevel: 'read', executable: false },
      { name: 'job.read', description: 'Read job status', riskLevel: 'read', executable: false },
      { name: 'workflow.read', description: 'Read workflow configuration', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'travis-ci',
    name: 'Travis CI',
    vendor: 'Travis CI',
    category: 'cicd',
    description: 'Hosted CI service for GitHub and Bitbucket',
    icon: '🚀',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'build.read', description: 'Read build results', riskLevel: 'read', executable: false },
      { name: 'repo.read', description: 'Read repository configuration', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'argo-cd',
    name: 'Argo CD',
    vendor: 'Intuit',
    category: 'cicd',
    description: 'GitOps continuous delivery for Kubernetes',
    icon: '📡',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'application.read', description: 'Read application status', riskLevel: 'read', executable: false },
      { name: 'sync.read', description: 'Read sync status', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token', 'cert'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];