// AI / ML Plugins - Part 2
// This file exports the second batch. Combine with part 1 for full catalog.

module.exports = [
  {
    id: 'huggingface',
    name: 'Hugging Face',
    vendor: 'Hugging Face',
    category: 'ai-ml',
    description: 'Platform for machine learning models and datasets',
    icon: ' Hugging Face',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'model.inference', description: 'Run model inference', riskLevel: 'read', executable: false },
      { name: 'dataset.read', description: 'Read dataset metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'mlflow',
    name: 'MLflow',
    vendor: 'Databricks',
    category: 'ai-ml',
    description: 'Open-source platform for ML lifecycle management',
    icon: ' MLflow',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'experiment.read', description: 'Read experiment data', riskLevel: 'read', executable: false },
      { name: 'run.read', description: 'Read run data', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'weights-biases',
    name: 'Weights & Biases',
    vendor: 'Weights & Biases',
    category: 'ai-ml',
    description: 'Machine learning experiment tracking',
    icon: ' W&B',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'run.read', description: 'Read run data', riskLevel: 'read', executable: false },
      { name: 'project.read', description: 'Read project metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'amazon-sagemaker',
    name: 'Amazon SageMaker',
    vendor: 'Amazon',
    category: 'ai-ml',
    description: 'Machine learning platform on AWS',
    icon: ' SageMaker',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'model.read', description: 'Read model metadata', riskLevel: 'read', executable: false },
      { name: 'endpoint.read', description: 'Read endpoint info', riskLevel: 'read', executable: false },
      { name: 'job.read', description: 'Read training job status', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['iam', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];