#!/usr/bin/env node

import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const COURTLISTENER_API_BASE = "https://www.courtlistener.com/api/rest/v4";

interface CourtInfo {
  id: string;
  short_name: string;
  full_name: string;
  jurisdiction: string; // F, ST, FB, MA, etc.
  start_date?: string;
  end_date?: string;
}

interface CourtCache {
  [key: string]: CourtInfo[];
  federal: CourtInfo[];
  state: CourtInfo[];
  "federal-bankruptcy": CourtInfo[];
  military: CourtInfo[];
  special: CourtInfo[];
  all: CourtInfo[];
}

interface CourtResourceFile {
  generated_at: string;
  total_courts: number;
  api_version: string;
  categories?: {
    federal: number;
    state: number;
    bankruptcy: number;
    military: number;
    special: number;
  };
  courts: CourtInfo[];
}

interface StateCourtResourceFile {
  state: string;
  generated_at: string;
  total_courts: number;
  court_types: {
    federal: string[];
    state: string[];
    bankruptcy: string[];
    local: string[];
  };
  courts: CourtInfo[];
}

interface CourtMappingsFile {
  generated_at: string;
  description: string;
  mappings: Record<string, string[]>;
}

class CourtResourceGenerator {
  private axiosInstance: AxiosInstance;
  private resourcesDir: string;

  constructor(apiKey: string = "") {
    this.axiosInstance = axios.create({
      baseURL: COURTLISTENER_API_BASE,
      headers: {
        Authorization: apiKey ? `Token ${apiKey}` : undefined,
      },
    });
    
    this.resourcesDir = path.join(__dirname, '..', 'src', 'resources');
  }

  async generateAllResources(): Promise<void> {
    console.log('🚀 Starting court resource generation...');
    
    // Ensure directories exist
    await this.ensureDirectories();
    
    // Discover all courts from API
    const courts = await this.discoverAllCourts();
    
    if (courts.length === 0) {
      console.error('❌ No courts discovered from API. Check your API key and connection.');
      process.exit(1);
    }
    
    // Categorize courts by jurisdiction
    const categorizedCourts = this.categorizeCourtsByJurisdiction(courts);
    
    // Generate all resource files
    await this.generateCourtResources(categorizedCourts);
    await this.generateStateResources(categorizedCourts);
    await this.generateMappingResources(categorizedCourts);
    
    console.log('✅ Court resource generation completed successfully!');
    await this.validateGeneratedFiles();
  }

  private async ensureDirectories(): Promise<void> {
    const dirs = [
      this.resourcesDir,
      path.join(this.resourcesDir, 'courts'),
      path.join(this.resourcesDir, 'courts', 'states'),
      path.join(this.resourcesDir, 'jurisdictions')
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
      }
    }
  }

  private async discoverAllCourts(): Promise<Record<string, any>[]> {
    try {
      const allCourts: Record<string, any>[] = [];
      let page = 1;
      let hasMore = true;

      console.log('🔍 Discovering courts from CourtListener API...');

      while (hasMore && allCourts.length < 4000) { // Safety limit
        const response = await this.axiosInstance.get('/courts/', {
          params: { page, page_size: 200 },
        });

        const { results, next } = response.data;
        allCourts.push(...results);
        hasMore = !!next;
        page++;

        if (page % 5 === 0) {
          console.log(`   📊 Discovered ${allCourts.length} courts so far...`);
        }
      }

      console.log(`🎯 Total courts discovered: ${allCourts.length}`);
      return allCourts;
    } catch (error) {
      console.error('❌ Failed to discover courts:', error);
      return [];
    }
  }

  private categorizeCourtsByJurisdiction(courts: Record<string, any>[]): CourtCache {
    const categorized: CourtCache = {
      federal: [],
      state: [],
      "federal-bankruptcy": [],
      military: [],
      special: [],
      all: [],
    };

    courts.forEach((court) => {
      // Skip courts without proper data
      if (!court.id || !court.jurisdiction) {
        return;
      }

      const courtInfo: CourtInfo = {
        id: court.id,
        short_name: court.short_name || court.id,
        full_name: court.full_name || court.short_name || court.id,
        jurisdiction: court.jurisdiction,
        start_date: court.start_date,
        end_date: court.end_date,
      };

      categorized.all.push(courtInfo);

      switch (court.jurisdiction) {
        case "F":
          categorized.federal.push(courtInfo);
          break;
        case "ST":
          categorized.state.push(courtInfo);
          break;
        case "FB":
          categorized["federal-bankruptcy"].push(courtInfo);
          break;
        case "MA":
          categorized.military.push(courtInfo);
          break;
        case "FS":
          categorized.special.push(courtInfo);
          break;
        default:
          // For unknown jurisdiction types, still add to special
          categorized.special.push(courtInfo);
          break;
      }
    });

    console.log(`📈 Categorized courts:
      Total: ${categorized.all.length}
      Federal: ${categorized.federal.length}
      State: ${categorized.state.length}
      Federal Bankruptcy: ${categorized["federal-bankruptcy"].length}
      Military: ${categorized.military.length}
      Special: ${categorized.special.length}`);

    return categorized;
  }

  private async generateCourtResources(courts: CourtCache): Promise<void> {
    console.log('📝 Generating court resource files...');
    const timestamp = new Date().toISOString();

    // Generate all.json
    const allCourtsFile: CourtResourceFile = {
      generated_at: timestamp,
      total_courts: courts.all.length,
      api_version: "v4",
      categories: {
        federal: courts.federal.length,
        state: courts.state.length,
        bankruptcy: courts["federal-bankruptcy"].length,
        military: courts.military.length,
        special: courts.special.length,
      },
      courts: courts.all,
    };
    await this.writeJsonFile('courts/all.json', allCourtsFile);

    // Generate category-specific files
    const categories = [
      { key: 'federal', filename: 'federal.json' },
      { key: 'state', filename: 'state.json' },
      { key: 'federal-bankruptcy', filename: 'bankruptcy.json' },
      { key: 'military', filename: 'military.json' },
      { key: 'special', filename: 'special.json' },
    ];

    for (const { key, filename } of categories) {
      const categoryFile: CourtResourceFile = {
        generated_at: timestamp,
        total_courts: courts[key].length,
        api_version: "v4",
        courts: courts[key],
      };
      await this.writeJsonFile(`courts/${filename}`, categoryFile);
    }

    console.log('   ✅ Generated main court resource files');
  }

  private async generateStateResources(courts: CourtCache): Promise<void> {
    console.log('🗺️ Generating state-specific resources...');
    const timestamp = new Date().toISOString();

    // Get all US states (including hyphenated ones)
    const states = [
      'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
      'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
      'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana',
      'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
      'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
      'new-hampshire', 'new-jersey', 'new-mexico', 'new-york',
      'north-carolina', 'north-dakota', 'ohio', 'oklahoma', 'oregon',
      'pennsylvania', 'rhode-island', 'south-carolina', 'south-dakota',
      'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
      'west-virginia', 'wisconsin', 'wyoming'
    ];

    for (const state of states) {
      const stateCourts = this.findCourtsByState(state, courts);
      
      if (stateCourts.length === 0) {
        console.log(`   ⚠️ No courts found for ${state}`);
        continue;
      }

      const stateFile: StateCourtResourceFile = {
        state: state,
        generated_at: timestamp,
        total_courts: stateCourts.length,
        court_types: {
          federal: stateCourts.filter(c => c.jurisdiction === 'F').map(c => c.id),
          state: stateCourts.filter(c => c.jurisdiction === 'ST').map(c => c.id),
          bankruptcy: stateCourts.filter(c => c.jurisdiction === 'FB').map(c => c.id),
          local: stateCourts.filter(c => !['F', 'ST', 'FB'].includes(c.jurisdiction)).map(c => c.id),
        },
        courts: stateCourts,
      };

      await this.writeJsonFile(`courts/states/${state}.json`, stateFile);
    }

    console.log('   ✅ Generated state-specific resource files');
  }

  private findCourtsByState(stateName: string, courts: CourtCache): CourtInfo[] {
    const stateAbbreviations: Record<string, string[]> = {
      california: ["ca", "cal"],
      newyork: ["ny"],
      "new-york": ["ny"],
      texas: ["tx", "tex"],
      florida: ["fl", "fla"],
      illinois: ["il", "ill"],
      ohio: ["oh"],
      pennsylvania: ["pa"],
      michigan: ["mi"],
      georgia: ["ga"],
      northcarolina: ["nc"],
      "north-carolina": ["nc"],
      newjersey: ["nj"],
      "new-jersey": ["nj"],
      virginia: ["va"],
      washington: ["wa"],
      arizona: ["az"],
      massachusetts: ["ma"],
      tennessee: ["tn", "tenn"],
      indiana: ["in"],
      missouri: ["mo"],
      maryland: ["md"],
      wisconsin: ["wi"],
      colorado: ["co"],
      minnesota: ["mn"],
      southcarolina: ["sc"],
      "south-carolina": ["sc"],
      alabama: ["al"],
      louisiana: ["la"],
      kentucky: ["ky"],
      oregon: ["or"],
      oklahoma: ["ok"],
      connecticut: ["ct", "conn"],
      utah: ["ut"],
      iowa: ["ia"],
      nevada: ["nv"],
      arkansas: ["ar"],
      mississippi: ["ms"],
      kansas: ["ks"],
      newmexico: ["nm"],
      "new-mexico": ["nm"],
      nebraska: ["ne"],
      westvirginia: ["wv"],
      "west-virginia": ["wv"],
      idaho: ["id"],
      hawaii: ["hi"],
      newhampshire: ["nh"],
      "new-hampshire": ["nh"],
      maine: ["me"],
      montana: ["mt"],
      rhodeisland: ["ri"],
      "rhode-island": ["ri"],
      delaware: ["de"],
      southdakota: ["sd"],
      "south-dakota": ["sd"],
      northdakota: ["nd"],
      "north-dakota": ["nd"],
      alaska: ["ak"],
      vermont: ["vt"],
      wyoming: ["wy"],
    };

    const stateCodes = stateAbbreviations[stateName] || stateAbbreviations[stateName.replace(/[-_\s]/g, "")] || [stateName];

    return courts.all.filter((court) => {
      const courtId = court.id.toLowerCase();
      return stateCodes.some((code) => courtId.startsWith(code));
    });
  }

  private async generateMappingResources(courts: CourtCache): Promise<void> {
    console.log('🗂️ Generating jurisdiction mappings...');
    const timestamp = new Date().toISOString();

    const mappings: Record<string, string[]> = {
      // Special categories
      all: [], // Empty = no filter = all courts
      federal: courts.federal.map(c => c.id),
      state: courts.state.map(c => c.id),
      bankruptcy: courts["federal-bankruptcy"].map(c => c.id),
      "federal-bankruptcy": courts["federal-bankruptcy"].map(c => c.id),
      military: courts.military.map(c => c.id),
      special: courts.special.map(c => c.id),
    };

    // Add state mappings with all variations
    const stateVariations = [
      { names: ['california', 'ca', 'calif'], codes: ['ca', 'cal'] },
      { names: ['new-york', 'newyork', 'ny'], codes: ['ny'] },
      { names: ['texas', 'tx', 'tex'], codes: ['tx', 'tex'] },
      { names: ['florida', 'fl', 'fla'], codes: ['fl', 'fla'] },
      { names: ['south-carolina', 'southcarolina', 'sc'], codes: ['sc'] },
      { names: ['north-carolina', 'northcarolina', 'nc'], codes: ['nc'] },
      { names: ['new-jersey', 'newjersey', 'nj'], codes: ['nj'] },
      { names: ['new-mexico', 'newmexico', 'nm'], codes: ['nm'] },
      { names: ['west-virginia', 'westvirginia', 'wv'], codes: ['wv'] },
      { names: ['new-hampshire', 'newhampshire', 'nh'], codes: ['nh'] },
      { names: ['rhode-island', 'rhodeisland', 'ri'], codes: ['ri'] },
      { names: ['south-dakota', 'southdakota', 'sd'], codes: ['sd'] },
      { names: ['north-dakota', 'northdakota', 'nd'], codes: ['nd'] },
      // Add all other states...
      { names: ['illinois', 'il', 'ill'], codes: ['il', 'ill'] },
      { names: ['ohio', 'oh'], codes: ['oh'] },
      { names: ['pennsylvania', 'pa'], codes: ['pa'] },
      { names: ['michigan', 'mi'], codes: ['mi'] },
      { names: ['georgia', 'ga'], codes: ['ga'] },
      { names: ['virginia', 'va'], codes: ['va'] },
      { names: ['washington', 'wa'], codes: ['wa'] },
      { names: ['arizona', 'az'], codes: ['az'] },
      { names: ['massachusetts', 'ma'], codes: ['ma'] },
      { names: ['tennessee', 'tn', 'tenn'], codes: ['tn', 'tenn'] },
      { names: ['indiana', 'in'], codes: ['in'] },
      { names: ['missouri', 'mo'], codes: ['mo'] },
      { names: ['maryland', 'md'], codes: ['md'] },
      { names: ['wisconsin', 'wi'], codes: ['wi'] },
      { names: ['colorado', 'co'], codes: ['co'] },
      { names: ['minnesota', 'mn'], codes: ['mn'] },
      { names: ['alabama', 'al'], codes: ['al'] },
      { names: ['louisiana', 'la'], codes: ['la'] },
      { names: ['kentucky', 'ky'], codes: ['ky'] },
      { names: ['oregon', 'or'], codes: ['or'] },
      { names: ['oklahoma', 'ok'], codes: ['ok'] },
      { names: ['connecticut', 'ct', 'conn'], codes: ['ct', 'conn'] },
      { names: ['utah', 'ut'], codes: ['ut'] },
      { names: ['iowa', 'ia'], codes: ['ia'] },
      { names: ['nevada', 'nv'], codes: ['nv'] },
      { names: ['arkansas', 'ar'], codes: ['ar'] },
      { names: ['mississippi', 'ms'], codes: ['ms'] },
      { names: ['kansas', 'ks'], codes: ['ks'] },
      { names: ['nebraska', 'ne'], codes: ['ne'] },
      { names: ['idaho', 'id'], codes: ['id'] },
      { names: ['hawaii', 'hi'], codes: ['hi'] },
      { names: ['maine', 'me'], codes: ['me'] },
      { names: ['montana', 'mt'], codes: ['mt'] },
      { names: ['delaware', 'de'], codes: ['de'] },
      { names: ['alaska', 'ak'], codes: ['ak'] },
      { names: ['vermont', 'vt'], codes: ['vt'] },
      { names: ['wyoming', 'wy'], codes: ['wy'] },
    ];

    for (const { names, codes } of stateVariations) {
      const stateCourts = courts.all.filter((court) => {
        const courtId = court.id.toLowerCase();
        return codes.some((code) => courtId.startsWith(code));
      }).map(c => c.id);

      for (const name of names) {
        mappings[name] = stateCourts;
      }
    }

    const mappingsFile: CourtMappingsFile = {
      generated_at: timestamp,
      description: "Maps jurisdiction input strings to court ID arrays",
      mappings,
    };

    await this.writeJsonFile('jurisdictions/court-mappings.json', mappingsFile);
    console.log('   ✅ Generated jurisdiction mappings');
  }

  async createSampleResources(): Promise<void> {
    console.log('📝 Creating sample resource files...');
    
    // Ensure directories exist
    await this.ensureDirectories();
    
    // Create sample courts data
    const sampleCourts = this.createSampleCourtsData();
    
    // Generate resource files with sample data
    await this.generateCourtResources(sampleCourts);
    await this.generateStateResources(sampleCourts);
    await this.generateMappingResources(sampleCourts);
    
    console.log('✅ Sample resource files created successfully!');
    console.log('💡 These contain a minimal set of US courts for development/testing');
    console.log('🔑 Set COURTLISTENER_API_KEY to generate complete resource files');
    
    await this.validateGeneratedFiles();
  }

  private createSampleCourtsData(): CourtCache {
    const sampleAllCourts: CourtInfo[] = [
      // Federal Courts
      { id: "scotus", short_name: "U.S.", full_name: "Supreme Court of the United States", jurisdiction: "F" },
      { id: "ca9", short_name: "9th Cir.", full_name: "United States Court of Appeals for the Ninth Circuit", jurisdiction: "F" },
      { id: "ca2", short_name: "2nd Cir.", full_name: "United States Court of Appeals for the Second Circuit", jurisdiction: "F" },
      { id: "cacd", short_name: "C.D. Cal.", full_name: "United States District Court for the Central District of California", jurisdiction: "F" },
      { id: "nysd", short_name: "S.D.N.Y.", full_name: "United States District Court for the Southern District of New York", jurisdiction: "F" },
      
      // State Courts
      { id: "cal", short_name: "Cal.", full_name: "Supreme Court of California", jurisdiction: "ST" },
      { id: "ny", short_name: "N.Y.", full_name: "New York Court of Appeals", jurisdiction: "ST" },
      { id: "tex", short_name: "Tex.", full_name: "Supreme Court of Texas", jurisdiction: "ST" },
      { id: "fla", short_name: "Fla.", full_name: "Supreme Court of Florida", jurisdiction: "ST" },
      { id: "sc", short_name: "S.C.", full_name: "Supreme Court of South Carolina", jurisdiction: "ST" },
      
      // Bankruptcy Courts
      { id: "cacb", short_name: "Bankr. C.D. Cal.", full_name: "United States Bankruptcy Court for the Central District of California", jurisdiction: "FB" },
      { id: "nysb", short_name: "Bankr. S.D.N.Y.", full_name: "United States Bankruptcy Court for the Southern District of New York", jurisdiction: "FB" },
      
      // Military Courts
      { id: "asbca", short_name: "A.S.B.C.A.", full_name: "Armed Services Board of Contract Appeals", jurisdiction: "MA" },
      
      // Special Courts
      { id: "tax", short_name: "T.C.", full_name: "United States Tax Court", jurisdiction: "FS" },
    ];

    return this.categorizeCourtsByJurisdiction(sampleAllCourts.map(c => ({
      id: c.id,
      short_name: c.short_name,
      full_name: c.full_name,
      jurisdiction: c.jurisdiction,
      start_date: null,
      end_date: null,
    })));
  }

  private async writeJsonFile(relativePath: string, data: any): Promise<void> {
    const fullPath = path.join(this.resourcesDir, relativePath);
    const jsonContent = JSON.stringify(data, null, 2);
    
    fs.writeFileSync(fullPath, jsonContent, 'utf8');
    console.log(`   📄 Created: ${relativePath}`);
  }

  private async validateGeneratedFiles(): Promise<void> {
    console.log('🔍 Validating generated resource files...');
    
    const expectedFiles = [
      'courts/all.json',
      'courts/federal.json',
      'courts/state.json',
      'courts/bankruptcy.json',
      'courts/military.json',
      'courts/special.json',
      'jurisdictions/court-mappings.json'
    ];

    let validationErrors = 0;

    for (const file of expectedFiles) {
      const filePath = path.join(this.resourcesDir, file);
      try {
        if (!fs.existsSync(filePath)) {
          console.error(`   ❌ Missing file: ${file}`);
          validationErrors++;
          continue;
        }

        const content = fs.readFileSync(filePath, 'utf8');
        JSON.parse(content); // Validate JSON format
        console.log(`   ✅ Valid: ${file}`);
      } catch (error) {
        console.error(`   ❌ Invalid JSON in ${file}:`, error);
        validationErrors++;
      }
    }

    // Validate state files
    const statesDir = path.join(this.resourcesDir, 'courts', 'states');
    if (fs.existsSync(statesDir)) {
      const stateFiles = fs.readdirSync(statesDir);
      console.log(`   📊 Found ${stateFiles.length} state files`);
      
      for (const stateFile of stateFiles.slice(0, 5)) { // Validate first 5 as sample
        try {
          const content = fs.readFileSync(path.join(statesDir, stateFile), 'utf8');
          JSON.parse(content);
        } catch (error) {
          console.error(`   ❌ Invalid state file ${stateFile}:`, error);
          validationErrors++;
        }
      }
    }

    if (validationErrors === 0) {
      console.log('✅ All resource files validated successfully!');
    } else {
      console.error(`❌ Found ${validationErrors} validation errors`);
      process.exit(1);
    }
  }
}

// Main execution
async function main() {
  const apiKey = process.env.COURTLISTENER_API_KEY;
  
  console.log('🎯 CourtListener Court Resource Generator');
  console.log('📁 Loading from .env file:', path.join(__dirname, '..', '.env'));
  
  if (!apiKey) {
    console.log('⚠️ No COURTLISTENER_API_KEY found - creating sample resource files');
    console.log('💡 To generate real data:');
    console.log('   1. Add your API key to .env file: COURTLISTENER_API_KEY="your_key_here"');
    console.log('   2. Or set environment variable: export COURTLISTENER_API_KEY="your_key_here"');
    
    // Create sample resources for development/testing
    const generator = new CourtResourceGenerator();
    await generator.createSampleResources();
    return;
  }

  console.log('🔑 Using API key:', apiKey.substring(0, 8) + '...');
  console.log('🌐 Connecting to CourtListener API to fetch all courts...');

  const generator = new CourtResourceGenerator(apiKey);
  
  try {
    await generator.generateAllResources();
  } catch (error) {
    console.error('💥 Generation failed:', error);
    process.exit(1);
  }
}

// Run if called directly (ES module check)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { CourtResourceGenerator };