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
      
      // State-specific resources (hardcoded for Smithery compatibility)
      ...this.getStateResources(),
      
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

    // Handle state court URIs (courts/state-california -> courts/state-california.json)
    if (withoutScheme.startsWith('courts/state-')) {
      return path.join(this.RESOURCES_DIR, withoutScheme + '.json');
    }

    // Default case: assume it's already a valid path with .json extension
    return path.join(this.RESOURCES_DIR, withoutScheme + '.json');
  }
  
  private static getStateResources(): Resource[] {
    return [
      { uri: 'courtlistener://courts/state-alabama', name: 'Alabama Courts', mimeType: 'application/json', description: 'All courts in Alabama including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-alaska', name: 'Alaska Courts', mimeType: 'application/json', description: 'All courts in Alaska including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-arizona', name: 'Arizona Courts', mimeType: 'application/json', description: 'All courts in Arizona including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-arkansas', name: 'Arkansas Courts', mimeType: 'application/json', description: 'All courts in Arkansas including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-california', name: 'California Courts', mimeType: 'application/json', description: 'All courts in California including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-colorado', name: 'Colorado Courts', mimeType: 'application/json', description: 'All courts in Colorado including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-connecticut', name: 'Connecticut Courts', mimeType: 'application/json', description: 'All courts in Connecticut including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-delaware', name: 'Delaware Courts', mimeType: 'application/json', description: 'All courts in Delaware including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-florida', name: 'Florida Courts', mimeType: 'application/json', description: 'All courts in Florida including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-georgia', name: 'Georgia Courts', mimeType: 'application/json', description: 'All courts in Georgia including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-hawaii', name: 'Hawaii Courts', mimeType: 'application/json', description: 'All courts in Hawaii including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-idaho', name: 'Idaho Courts', mimeType: 'application/json', description: 'All courts in Idaho including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-illinois', name: 'Illinois Courts', mimeType: 'application/json', description: 'All courts in Illinois including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-indiana', name: 'Indiana Courts', mimeType: 'application/json', description: 'All courts in Indiana including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-iowa', name: 'Iowa Courts', mimeType: 'application/json', description: 'All courts in Iowa including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-kansas', name: 'Kansas Courts', mimeType: 'application/json', description: 'All courts in Kansas including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-kentucky', name: 'Kentucky Courts', mimeType: 'application/json', description: 'All courts in Kentucky including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-louisiana', name: 'Louisiana Courts', mimeType: 'application/json', description: 'All courts in Louisiana including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-maine', name: 'Maine Courts', mimeType: 'application/json', description: 'All courts in Maine including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-maryland', name: 'Maryland Courts', mimeType: 'application/json', description: 'All courts in Maryland including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-massachusetts', name: 'Massachusetts Courts', mimeType: 'application/json', description: 'All courts in Massachusetts including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-michigan', name: 'Michigan Courts', mimeType: 'application/json', description: 'All courts in Michigan including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-minnesota', name: 'Minnesota Courts', mimeType: 'application/json', description: 'All courts in Minnesota including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-mississippi', name: 'Mississippi Courts', mimeType: 'application/json', description: 'All courts in Mississippi including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-missouri', name: 'Missouri Courts', mimeType: 'application/json', description: 'All courts in Missouri including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-montana', name: 'Montana Courts', mimeType: 'application/json', description: 'All courts in Montana including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-nebraska', name: 'Nebraska Courts', mimeType: 'application/json', description: 'All courts in Nebraska including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-nevada', name: 'Nevada Courts', mimeType: 'application/json', description: 'All courts in Nevada including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-new-hampshire', name: 'New Hampshire Courts', mimeType: 'application/json', description: 'All courts in New Hampshire including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-new-jersey', name: 'New Jersey Courts', mimeType: 'application/json', description: 'All courts in New Jersey including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-new-mexico', name: 'New Mexico Courts', mimeType: 'application/json', description: 'All courts in New Mexico including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-new-york', name: 'New York Courts', mimeType: 'application/json', description: 'All courts in New York including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-north-carolina', name: 'North Carolina Courts', mimeType: 'application/json', description: 'All courts in North Carolina including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-north-dakota', name: 'North Dakota Courts', mimeType: 'application/json', description: 'All courts in North Dakota including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-ohio', name: 'Ohio Courts', mimeType: 'application/json', description: 'All courts in Ohio including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-oklahoma', name: 'Oklahoma Courts', mimeType: 'application/json', description: 'All courts in Oklahoma including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-oregon', name: 'Oregon Courts', mimeType: 'application/json', description: 'All courts in Oregon including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-pennsylvania', name: 'Pennsylvania Courts', mimeType: 'application/json', description: 'All courts in Pennsylvania including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-rhode-island', name: 'Rhode Island Courts', mimeType: 'application/json', description: 'All courts in Rhode Island including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-south-carolina', name: 'South Carolina Courts', mimeType: 'application/json', description: 'All courts in South Carolina including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-south-dakota', name: 'South Dakota Courts', mimeType: 'application/json', description: 'All courts in South Dakota including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-tennessee', name: 'Tennessee Courts', mimeType: 'application/json', description: 'All courts in Tennessee including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-texas', name: 'Texas Courts', mimeType: 'application/json', description: 'All courts in Texas including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-utah', name: 'Utah Courts', mimeType: 'application/json', description: 'All courts in Utah including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-vermont', name: 'Vermont Courts', mimeType: 'application/json', description: 'All courts in Vermont including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-virginia', name: 'Virginia Courts', mimeType: 'application/json', description: 'All courts in Virginia including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-washington', name: 'Washington Courts', mimeType: 'application/json', description: 'All courts in Washington including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-west-virginia', name: 'West Virginia Courts', mimeType: 'application/json', description: 'All courts in West Virginia including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-wisconsin', name: 'Wisconsin Courts', mimeType: 'application/json', description: 'All courts in Wisconsin including federal, state, bankruptcy, and local courts' },
      { uri: 'courtlistener://courts/state-wyoming', name: 'Wyoming Courts', mimeType: 'application/json', description: 'All courts in Wyoming including federal, state, bankruptcy, and local courts' }
    ];
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