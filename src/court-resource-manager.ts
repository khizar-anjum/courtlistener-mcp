import * as fs from 'fs';
import * as path from 'path';

// Get directory path compatible with both ESM and CJS
function getCurrentDir(): string {
  // Try ESM approach first
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      const { fileURLToPath } = require('url');
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {
    // Fall through to CJS approach
  }
  
  // Fallback to CJS approach
  if (typeof __dirname !== 'undefined') {
    return __dirname;
  }
  
  // Last resort: use process.cwd() and assume src directory
  return path.join(process.cwd(), 'src');
}

const currentDir = getCurrentDir();

interface Resource {
  uri: string;
  name: string;
  mimeType: string;
  description?: string;
}

export class CourtResourceManager {
  private static readonly RESOURCES_DIR = this.findResourcesDir();
  
  private static findResourcesDir(): string {
    const possiblePaths = [
      // Development: src/resources
      path.join(currentDir, 'resources'),
      // Built: .smithery/resources (for Smithery deployment)
      path.join(currentDir, 'resources'),
      path.join(process.cwd(), '.smithery', 'resources'),
      path.join(process.cwd(), 'resources'),
      // Fallback paths
      path.join(__dirname, 'resources'),
      path.join(__dirname, '..', 'resources'),
    ];
    
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        return possiblePath;
      }
    }
    
    // Default fallback
    return path.join(currentDir, 'resources');
  }
  
  static listResources(): Resource[] {
    const resources: Resource[] = [
      // Main court resources
      { 
        uri: 'courtlistener://courts/all', 
        name: 'All Courts', 
        mimeType: 'application/json',
        description: 'Complete list of all 3,353+ courts in the CourtListener database'
      },
      { 
        uri: 'courtlistener://courts/federal', 
        name: 'Federal Courts', 
        mimeType: 'application/json',
        description: 'All federal courts including Supreme Court, Circuit Courts, and District Courts'
      },
      { 
        uri: 'courtlistener://courts/state', 
        name: 'State Courts', 
        mimeType: 'application/json',
        description: 'All state supreme courts, appellate courts, and trial courts'
      },
      { 
        uri: 'courtlistener://courts/bankruptcy', 
        name: 'Bankruptcy Courts', 
        mimeType: 'application/json',
        description: 'Federal bankruptcy courts across all districts'
      },
      { 
        uri: 'courtlistener://courts/military', 
        name: 'Military Courts', 
        mimeType: 'application/json',
        description: 'Military courts and appeals boards'
      },
      { 
        uri: 'courtlistener://courts/special', 
        name: 'Special Courts', 
        mimeType: 'application/json',
        description: 'Special federal courts like Tax Court, Court of Federal Claims, etc.'
      },
      
      // State-specific resources (generated dynamically)
      ...this.generateStateResources(),
      
      // Jurisdiction mappings
      { 
        uri: 'courtlistener://jurisdictions/court-mappings', 
        name: 'Court Mappings', 
        mimeType: 'application/json',
        description: 'Maps jurisdiction input strings to court ID arrays for search optimization'
      }
    ];

    return resources;
  }
  
  static readResource(uri: string): string {
    const filePath = this.uriToFilePath(uri);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Resource not found: ${uri}`);
    }
    return fs.readFileSync(filePath, 'utf8');
  }
  
  static resourceExists(uri: string): boolean {
    const filePath = this.uriToFilePath(uri);
    return fs.existsSync(filePath);
  }

  static getResourceStats(uri: string): { size: number; modified: Date } | null {
    const filePath = this.uriToFilePath(uri);
    try {
      const stats = fs.statSync(filePath);
      return {
        size: stats.size,
        modified: stats.mtime
      };
    } catch {
      return null;
    }
  }
  
  private static uriToFilePath(uri: string): string {
    // Remove the scheme
    const withoutScheme = uri.replace('courtlistener://', '');
    
    // Map URIs to file paths
    const mappings: Record<string, string> = {
      'courts/all': 'courts/all.json',
      'courts/federal': 'courts/federal.json',
      'courts/state': 'courts/state.json',
      'courts/bankruptcy': 'courts/bankruptcy.json',
      'courts/military': 'courts/military.json',
      'courts/special': 'courts/special.json',
      'jurisdictions/court-mappings': 'jurisdictions/court-mappings.json'
    };

    // Handle exact matches first
    if (mappings[withoutScheme]) {
      return path.join(this.RESOURCES_DIR, mappings[withoutScheme]);
    }

    // Handle state court URIs (courts/states/california -> courts/states/california.json)
    if (withoutScheme.startsWith('courts/states/')) {
      return path.join(this.RESOURCES_DIR, withoutScheme + '.json');
    }

    // Default case: assume it's already a valid path with .json extension
    return path.join(this.RESOURCES_DIR, withoutScheme + '.json');
  }
  
  private static generateStateResources(): Resource[] {
    const statesDir = path.join(this.RESOURCES_DIR, 'courts', 'states');
    
    if (!fs.existsSync(statesDir)) {
      console.warn('States directory not found, no state resources available');
      return [];
    }

    try {
      const stateFiles = fs.readdirSync(statesDir);
      return stateFiles
        .filter(file => file.endsWith('.json'))
        .map(file => {
          const stateName = file.replace('.json', '');
          const displayName = stateName
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
          
          return {
            uri: `courtlistener://courts/states/${stateName}`,
            name: `${displayName} Courts`,
            mimeType: 'application/json',
            description: `All courts in ${displayName} including federal, state, bankruptcy, and local courts`
          };
        });
    } catch (error) {
      console.error('Error reading states directory:', error);
      return [];
    }
  }

  // Utility method to get all available jurisdictions for validation
  static getAvailableJurisdictions(): string[] {
    try {
      const mappingsContent = this.readResource('courtlistener://jurisdictions/court-mappings');
      const mappings = JSON.parse(mappingsContent);
      return Object.keys(mappings.mappings || {});
    } catch (error) {
      console.error('Error reading jurisdiction mappings:', error);
      return [];
    }
  }

  // Utility method to resolve jurisdiction to court IDs (replacement for async version)
  static resolveJurisdiction(jurisdiction: string): string[] {
    try {
      const mappingsContent = this.readResource('courtlistener://jurisdictions/court-mappings');
      const mappings = JSON.parse(mappingsContent);
      
      const lowerJurisdiction = jurisdiction.toLowerCase();
      return mappings.mappings[lowerJurisdiction] || [];
    } catch (error) {
      console.error(`Error resolving jurisdiction "${jurisdiction}":`, error);
      return [];
    }
  }

  // Utility method to suggest similar jurisdictions
  static suggestSimilarJurisdictions(input: string): string[] {
    try {
      const mappingsContent = this.readResource('courtlistener://jurisdictions/court-mappings');
      const mappings = JSON.parse(mappingsContent);
      
      const suggestions = Object.keys(mappings.mappings || {}).filter(key => 
        key.includes(input.toLowerCase())
      );
      
      return suggestions.slice(0, 5);
    } catch (error) {
      console.error(`Error getting jurisdiction suggestions for "${input}":`, error);
      return [];
    }
  }

  // Debug method to list all available resource files
  static debugListFiles(): void {
    console.log('🔍 Available resource files:');
    const listFiles = (dir: string, prefix = '') => {
      try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            console.log(`  📁 ${prefix}${item.name}/`);
            listFiles(fullPath, prefix + '  ');
          } else {
            const relativePath = path.relative(this.RESOURCES_DIR, fullPath);
            console.log(`  📄 ${prefix}${item.name} -> courtlistener://${relativePath.replace(/\.json$/, '')}`);
          }
        }
      } catch (error) {
        console.error(`Error reading directory ${dir}:`, error);
      }
    };

    if (fs.existsSync(this.RESOURCES_DIR)) {
      listFiles(this.RESOURCES_DIR);
    } else {
      console.log('❌ Resources directory not found. Run npm run generate-courts first.');
    }
  }
}