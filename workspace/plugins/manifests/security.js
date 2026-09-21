// Security / Quality Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'sonarqube',
    name: 'SonarQube',
    vendor: 'SonarSource',
    category: 'security',
    description: 'Code quality and security analysis platform',
    icon: ' SonarQube',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'project.read', description: 'Read project metadata', riskLevel: 'read', executable: false },
      { name: 'issue.read', description: 'Read issue data', riskLevel: 'read', executable: false },
      { name: 'metric.read', description: 'Read quality metrics', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'snyk',
    name: 'Snyk',
    vendor: 'Snyk',
    category: 'security',
    description: 'Developer security platform for vulnerability detection',
    icon: ' Snyk',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'project.read', description: 'Read project metadata', riskLevel: 'read', executable: false },
      { name: 'vulnerability.read', description: 'Read vulnerability data', riskLevel: 'read', executable: false },
      { name: 'test.execute', description: 'Run security test', riskLevel: 'execute', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'checkmarx',
    name: 'Checkmarx',
    vendor: 'Checkmarx',
    category: 'security',
    description: 'Application security testing platform',
    icon: ' Checkmarx',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'scan.read', description: 'Read scan results', riskLevel: 'read', executable: false },
      { name: 'vulnerability.read', description: 'Read vulnerability data', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'veracode',
    name: 'Veracode',
    vendor: 'Veracode',
    category: 'security',
    description: 'Application security testing and analysis',
    icon: ' Veracode',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'scan.read', description: 'Read scan results', riskLevel: 'read', executable: false },
      { name: 'vulnerability.read', description: 'Read vulnerability data', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];