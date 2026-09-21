// Containers / Orchestration Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'docker',
    name: 'Docker',
    vendor: 'Docker',
    category: 'containers',
    description: 'Container platform for building and running applications',
    icon: '🐳',
    connectionType: 'cli',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'image.read', description: 'Read image metadata', riskLevel: 'read', executable: false },
      { name: 'container.read', description: 'Read container status', riskLevel: 'read', executable: false },
      { name: 'container.list', description: 'List running containers', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'privileged', 'destructive'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'kubernetes',
    name: 'Kubernetes',
    vendor: 'CNCF',
    category: 'containers',
    description: 'Container orchestration platform for automated deployment',
    icon: '⎈',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'pod.read', description: 'Read pod status', riskLevel: 'read', executable: false },
      { name: 'node.read', description: 'Read node information', riskLevel: 'read', executable: false },
      { name: 'deployment.read', description: 'Read deployment metadata', riskLevel: 'read', executable: false },
      { name: 'service.read', description: 'Read service configuration', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'privileged', 'destructive'],
    supportedAuth: ['token', 'cert'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'openshift',
    name: 'OpenShift',
    vendor: 'Red Hat',
    category: 'containers',
    description: 'Enterprise Kubernetes platform with added security',
    icon: '红帽',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'project.read', description: 'Read project metadata', riskLevel: 'read', executable: false },
      { name: 'pod.read', description: 'Read pod status', riskLevel: 'read', executable: false },
      { name: 'deployment.read', description: 'Read deployment metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'privileged', 'destructive'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'helm',
    name: 'Helm',
    vendor: 'CNCF',
    category: 'containers',
    description: 'Kubernetes package manager for chart management',
    icon: '',
    connectionType: 'cli',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'chart.read', description: 'Read chart metadata', riskLevel: 'read', executable: false },
      { name: 'release.read', description: 'Read release information', riskLevel: 'read', executable: false },
      { name: 'repo.list', description: 'List chart repositories', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];