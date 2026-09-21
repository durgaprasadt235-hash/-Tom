// API / Testing Plugins - Part 2
// This file exports the second batch. Combine with part 1 for full catalog.

module.exports = [
  {
    id: 'cypress',
    name: 'Cypress',
    vendor: 'Cypress.io',
    category: 'testing',
    description: 'Frontend testing framework for web applications',
    icon: ' Cypress',
    connectionType: 'cli',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'test.read', description: 'Read test metadata', riskLevel: 'read', executable: false },
      { name: 'test.execute', description: 'Run test execution', riskLevel: 'execute', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['none'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'selenium',
    name: 'Selenium',
    vendor: 'Selenium',
    category: 'testing',
    description: 'Browser automation for testing web applications',
    icon: ' Selenium',
    connectionType: 'cli',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'test.read', description: 'Read test metadata', riskLevel: 'read', executable: false },
      { name: 'test.execute', description: 'Run test execution', riskLevel: 'execute', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['none'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'jest',
    name: 'Jest',
    vendor: 'Meta',
    category: 'testing',
    description: 'JavaScript testing framework',
    icon: ' Jest',
    connectionType: 'cli',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'test.read', description: 'Read test metadata', riskLevel: 'read', executable: false },
      { name: 'test.execute', description: 'Run test execution', riskLevel: 'execute', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['none'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'vitest',
    name: 'Vitest',
    vendor: 'Vitest',
    category: 'testing',
    description: 'Fast unit testing framework for Vite',
    icon: ' Vitest',
    connectionType: 'cli',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'test.read', description: 'Read test metadata', riskLevel: 'read', executable: false },
      { name: 'test.execute', description: 'Run test execution', riskLevel: 'execute', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['none'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'pytest',
    name: 'pytest',
    vendor: 'pytest',
    category: 'testing',
    description: 'Python testing framework',
    icon: ' pytest',
    connectionType: 'cli',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'test.read', description: 'Read test metadata', riskLevel: 'read', executable: false },
      { name: 'test.execute', description: 'Run test execution', riskLevel: 'execute', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['none'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'junit',
    name: 'JUnit',
    vendor: 'Eclipse',
    category: 'testing',
    description: 'Unit testing framework for Java',
    icon: ' JUnit',
    connectionType: 'cli',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'test.read', description: 'Read test metadata', riskLevel: 'read', executable: false },
      { name: 'test.execute', description: 'Run test execution', riskLevel: 'execute', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['none'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];