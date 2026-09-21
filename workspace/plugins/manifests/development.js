// Development / IDE Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'vscode',
    name: 'VS Code',
    vendor: 'Microsoft',
    category: 'development',
    description: 'Code editor integration for workspace file access and diagnostics',
    icon: '📝',
    connectionType: 'extension',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'vscode.workspace.info', description: 'Describe the authorized workspace', riskLevel: 'read', executable: true },
      { name: 'vscode.workspace.tree', description: 'Read the safe authorized project tree', riskLevel: 'read', executable: true },
      { name: 'vscode.file.active', description: 'Read active editor identity through the local VS Code extension bridge', riskLevel: 'read', executable: true },
      { name: 'vscode.diagnostics', description: 'Read real diagnostics through the local VS Code extension bridge', riskLevel: 'read', executable: true },
      { name: 'vscode.file.changes', description: 'Read recent authorized file-save events reported by the local VS Code extension bridge', riskLevel: 'read', executable: true },
      { name: 'vscode.file.read', description: 'Read an authorized project source file (read-only, 1 MB limit)', riskLevel: 'read', executable: true },
      { name: 'vscode.file.propose_edit', description: 'Propose an approved-write edit to an authorized project file (does not write)', riskLevel: 'read', executable: true },
      { name: 'vscode.file.apply_edit', description: 'Apply a previously approved, single-use edit to an authorized project file', riskLevel: 'approved_write', executable: true }
    ],
    riskLevels: ['read', 'approved_write'],
    supportedAuth: ['local_bridge'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'visualstudio',
    name: 'Visual Studio',
    vendor: 'Microsoft',
    category: 'development',
    description: 'Full-featured IDE for .NET and C++ development',
    icon: '🔷',
    connectionType: 'extension',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'workspace.read', description: 'Read solution structure', riskLevel: 'read', executable: false },
      { name: 'project.read', description: 'Read project configuration', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'intellij',
    name: 'IntelliJ IDEA',
    vendor: 'JetBrains',
    category: 'development',
    description: 'Powerful IDE for Java, Kotlin, and other JVM languages',
    icon: '',
    connectionType: 'extension',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'workspace.read', description: 'Read project structure', riskLevel: 'read', executable: false },
      { name: 'file.active.read', description: 'Read active file', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'pycharm',
    name: 'PyCharm',
    vendor: 'JetBrains',
    category: 'development',
    description: 'Python IDE with intelligent code assistance',
    icon: '',
    connectionType: 'extension',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'workspace.read', description: 'Read project structure', riskLevel: 'read', executable: false },
      { name: 'file.active.read', description: 'Read active file', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'webstorm',
    name: 'WebStorm',
    vendor: 'JetBrains',
    category: 'development',
    description: 'JavaScript and TypeScript IDE',
    icon: '',
    connectionType: 'extension',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'workspace.read', description: 'Read project structure', riskLevel: 'read', executable: false },
      { name: 'file.active.read', description: 'Read active file', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'android-studio',
    name: 'Android Studio',
    vendor: 'Google',
    category: 'development',
    description: 'Official IDE for Android development',
    icon: '📱',
    connectionType: 'extension',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'workspace.read', description: 'Read project structure', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'xcode',
    name: 'Xcode',
    vendor: 'Apple',
    category: 'development',
    description: 'macOS IDE for iOS, macOS, and watchOS development',
    icon: '🛠',
    connectionType: 'extension',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'workspace.read', description: 'Read project structure', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'eclipse',
    name: 'Eclipse',
    vendor: 'Eclipse Foundation',
    category: 'development',
    description: 'Open-source IDE for Java and other languages',
    icon: '🌀',
    connectionType: 'extension',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'workspace.read', description: 'Read project structure', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'cursor',
    name: 'Cursor',
    vendor: 'Anysphere',
    category: 'development',
    description: 'AI-native code editor with built-in AI assistance',
    icon: '⌨',
    connectionType: 'extension',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'workspace.read', description: 'Read workspace file structure', riskLevel: 'read', executable: false },
      { name: 'file.active.read', description: 'Read active file contents', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];