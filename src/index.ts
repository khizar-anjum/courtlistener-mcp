import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";
import { z } from "zod";

// Configuration schema for the MCP server
export const configSchema = z.object({
  courtlistener_api_key: z
    .string()
    .optional()
    .describe("CourtListener API key for enhanced access"),
  debug: z.boolean().default(false).describe("Enable debug logging"),
});

const COURTLISTENER_API_BASE = "https://www.courtlistener.com/api/rest/v4";

interface SearchArgs {
  search_keywords: string[];
  problem_summary?: string;
  case_type?: string;
  date_range?: "recent-2years" | "established-precedent" | "all-time";
  limit?: number;
  jurisdiction?: string;
  court_level?: "trial" | "appellate" | "supreme" | "all";
}

interface CaseDetailsArgs {
  case_id: string;
  include_full_text?: boolean;
}

interface SimilarPrecedentsArgs {
  reference_case_id: string;
  legal_concepts?: string[];
  citation_threshold?: number;
  limit?: number;
  jurisdiction?: string;
}

interface AnalyzeCaseOutcomesArgs {
  case_type: string;
  court_level?: "trial" | "appellate" | "all";
  date_range?: "last-year" | "last-2years" | "last-5years";
  jurisdiction?: string;
}

interface JudgeAnalysisArgs {
  judge_name: string;
  case_type: string;
  court?: string;
  jurisdiction?: string;
}

interface ValidateCitationsArgs {
  citations: string[];
  context_text?: string;
  jurisdiction?: string;
}

interface ProceduralRequirementsArgs {
  case_type: string;
  jurisdiction: string;
  court?: string;
  claim_amount?: number;
}

interface TrackLegalTrendsArgs {
  legal_area:
    | "consumer-protection"
    | "small-claims"
    | "landlord-tenant"
    | "contract-disputes"
    | "warranty-claims";
  time_period?: "last-6months" | "last-year" | "last-2years";
  trend_type?:
    | "outcomes"
    | "filing-patterns"
    | "new-precedents"
    | "settlement-rates";
}

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


class CourtListenerMCPServer {
  private server: Server;
  private axiosInstance: AxiosInstance;
  private courtCache?: CourtCache;
  private cacheExpiry?: Date;
  private readonly CACHE_DURATION = 15 * 24 * 60 * 60 * 1000; // 15 days

  constructor(apiKey: string = "") {
    this.server = new Server(
      {
        name: "courtlistener-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupHandlers();
    this.axiosInstance = axios.create({
      baseURL: COURTLISTENER_API_BASE,
      headers: {
        Authorization: apiKey ? `Token ${apiKey}` : undefined,
      },
    });
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "search_cases_by_problem",
          description:
            "Find relevant cases using LLM-generated search keywords. The LLM should extract legal keywords from the problem description and provide them for precise case law search.",
          inputSchema: {
            type: "object",
            properties: {
              search_keywords: {
                type: "array",
                items: { type: "string" },
                description:
                  'Array of legal search terms extracted by LLM from problem description (e.g., ["breach of contract", "negligence", "damages"])',
                minItems: 1,
                maxItems: 10,
              },
              problem_summary: {
                type: "string",
                description:
                  "Brief summary of the legal problem for context (1-2 sentences)",
                maxLength: 500,
              },
              case_type: {
                type: "string",
                description: "Type of legal issue",
                enum: [
                  "consumer",
                  "small-claims",
                  "landlord-tenant",
                  "contract",
                  "warranty",
                  "debt-collection",
                  "auto",
                  "employment",
                  "civil-rights",
                  "corporate",
                  "criminal",
                  "family",
                  "immigration",
                  "intellectual-property",
                  "personal-injury",
                  "real-estate",
                  "tax",
                ],
              },
              date_range: {
                type: "string",
                description: "Time range preference for cases",
                enum: ["recent-2years", "established-precedent", "all-time"],
                default: "recent-2years",
              },
              limit: {
                type: "number",
                description: "Number of cases to return (1-20)",
                minimum: 1,
                maximum: 20,
                default: 10,
              },
              jurisdiction: {
                type: "string",
                description: `Jurisdiction to search. Options:
                  - "all" (search all courts)
                  - "federal" (all federal courts)
                  - "state" (all state courts)
                  - "federal-bankruptcy" (bankruptcy courts)
                  - "military" (military courts)
                  - State names: "california", "texas", "florida", etc.
                  - Specific court IDs: "scotus", "ca9", "ca11", etc.
                  - Multiple courts: "ca9,ca11,scotus" (comma-separated)`,
              },
              court_level: {
                type: "string",
                description: "Level of courts to search",
                enum: ["trial", "appellate", "supreme", "all"],
                default: "all",
              },
            },
            required: ["search_keywords"],
          },
        },
        {
          name: "get_case_details",
          description:
            "Deep dive into specific case for precedent analysis with full legal reasoning",
          inputSchema: {
            type: "object",
            properties: {
              case_id: {
                type: "string",
                description:
                  "Case ID from search results (cluster ID or docket ID)",
              },
              include_full_text: {
                type: "boolean",
                description: "Include full opinion text (may be large)",
                default: false,
              },
            },
            required: ["case_id"],
          },
        },
        {
          name: "find_similar_precedents",
          description:
            "Find cases with similar legal reasoning or outcomes to a reference case",
          inputSchema: {
            type: "object",
            properties: {
              reference_case_id: {
                type: "string",
                description: "ID of base case to find similar cases",
              },
              legal_concepts: {
                type: "array",
                items: { type: "string" },
                description:
                  'Key legal concepts to match (e.g., ["breach of contract", "negligence"])',
              },
              citation_threshold: {
                type: "number",
                description: "Minimum citation count for authoritative cases",
                default: 1,
              },
              limit: {
                type: "number",
                description: "Number of similar cases to return (1-15)",
                minimum: 1,
                maximum: 15,
                default: 8,
              },
              jurisdiction: {
                type: "string",
                description: `Jurisdiction to search for similar cases. Options:
                  - "all" (search all courts)
                  - "federal" (all federal courts)
                  - "state" (all state courts)
                  - State names: "california", "texas", "florida", etc.
                  - Specific court IDs: "scotus", "ca9", "ca11", etc.
                  - Multiple courts: "ca9,ca11,scotus" (comma-separated)`,
              },
            },
            required: ["reference_case_id"],
          },
        },
        {
          name: "analyze_case_outcomes",
          description:
            "Analyze outcome patterns for similar cases to predict success likelihood",
          inputSchema: {
            type: "object",
            properties: {
              case_type: {
                type: "string",
                description: "Type of legal issue to analyze",
              },
              court_level: {
                type: "string",
                description: "Court level to analyze",
                enum: ["trial", "appellate", "all"],
                default: "all",
              },
              date_range: {
                type: "string",
                description: "Time period for analysis",
                enum: ["last-year", "last-2years", "last-5years"],
                default: "last-2years",
              },
              jurisdiction: {
                type: "string",
                description: `Jurisdiction to analyze cases in. Options:
                  - "all" (analyze all courts)
                  - "federal" (all federal courts)
                  - "state" (all state courts)
                  - State names: "california", "new-york", "texas", etc.
                  - Specific court IDs: "scotus", "ca9", "cal", etc.`,
              },
            },
            required: ["case_type"],
          },
        },
        {
          name: "get_judge_analysis",
          description:
            "Analyze judge's typical rulings on similar issues for strategic insights",
          inputSchema: {
            type: "object",
            properties: {
              judge_name: {
                type: "string",
                description: "Full name of the judge",
              },
              case_type: {
                type: "string",
                description:
                  "Area of law to analyze (e.g., contract disputes, small claims, employment law)",
              },
              court: {
                type: "string",
                description: "Specific court identifier (optional, narrows down the search)",
              },
              jurisdiction: {
                type: "string",
                description: `Optional jurisdiction to help identify the correct judge. Options:
                  - "federal" (all federal courts)
                  - "state" (all state courts)
                  - State names: "california", "texas", "florida", etc.
                  - Specific court IDs: "scotus", "ca9", "ca11", etc.
                  Helps disambiguate common judge names.`,
              },
            },
            required: ["judge_name", "case_type"],
          },
        },
        {
          name: "validate_citations",
          description:
            "Verify and expand legal citations with related case discovery",
          inputSchema: {
            type: "object",
            properties: {
              citations: {
                type: "array",
                items: { type: "string" },
                description:
                  'List of citations to verify (e.g., ["123 F.3d 456", "Smith v. Jones"])',
              },
              context_text: {
                type: "string",
                description:
                  "Surrounding legal argument context for better validation",
              },
              jurisdiction: {
                type: "string",
                description: `Optional jurisdiction to improve search accuracy. Options:
                  - "federal" (all federal courts)
                  - "state" (all state courts)
                  - State names: "california", "texas", "florida", etc.
                  - Specific court IDs: "scotus", "ca9", "ca11", etc.
                  If omitted, searches all courts.`,
              },
            },
            required: ["citations"],
          },
        },
        {
          name: "get_procedural_requirements",
          description:
            "Find procedural rules and filing requirements for specific case types in any jurisdiction",
          inputSchema: {
            type: "object",
            properties: {
              case_type: {
                type: "string",
                description: "Type of legal complaint or case",
              },
              jurisdiction: {
                type: "string",
                description: `Jurisdiction to search for procedural requirements. Options:
                  - "federal" (all federal courts)
                  - "state" (all state courts)
                  - State names: "california", "new-york", "texas", etc.
                  - Specific court IDs: "scotus", "ca9", "cal", etc.`,
              },
              court: {
                type: "string",
                description: "Specific court identifier (optional, narrows down the search)",
              },
              claim_amount: {
                type: "number",
                description:
                  "Dollar amount of dispute (helps determine appropriate court level)",
              },
            },
            required: ["case_type", "jurisdiction"],
          },
        },
        {
          name: "track_legal_trends",
          description:
            "Identify recent trends in similar cases for strategic advantage",
          inputSchema: {
            type: "object",
            properties: {
              legal_area: {
                type: "string",
                description: "Area of law to analyze trends",
                enum: [
                  "consumer-protection",
                  "small-claims",
                  "landlord-tenant",
                  "contract-disputes",
                  "warranty-claims",
                ],
              },
              time_period: {
                type: "string",
                description: "Time period for trend analysis",
                enum: ["last-6months", "last-year", "last-2years"],
                default: "last-year",
              },
              trend_type: {
                type: "string",
                description: "Type of trend to analyze",
                enum: [
                  "outcomes",
                  "filing-patterns",
                  "new-precedents",
                  "settlement-rates",
                ],
                default: "outcomes",
              },
            },
            required: ["legal_area"],
          },
        },
      ] as Tool[],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "search_cases_by_problem":
            return await this.searchCasesByProblem(args as SearchArgs);
          case "get_case_details":
            return await this.getCaseDetails(args as CaseDetailsArgs);
          case "find_similar_precedents":
            return await this.findSimilarPrecedents(
              args as SimilarPrecedentsArgs,
            );
          case "analyze_case_outcomes":
            return await this.analyzeCaseOutcomes(
              args as AnalyzeCaseOutcomesArgs,
            );
          case "get_judge_analysis":
            return await this.getJudgeAnalysis(args as JudgeAnalysisArgs);
          case "validate_citations":
            return await this.validateCitations(args as ValidateCitationsArgs);
          case "get_procedural_requirements":
            return await this.getProceduralRequirements(
              args as ProceduralRequirementsArgs,
            );
          case "track_legal_trends":
            return await this.trackLegalTrends(args as TrackLegalTrendsArgs);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        console.error(`Error in tool ${name}:`, error);
        return {
          content: [
            {
              type: "text",
              text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}. Please check your parameters and try again.`,
            },
          ],
        };
      }
    });
  }

  private validateSearchKeywords(keywords: string[]): string[] {
    if (!Array.isArray(keywords) || keywords.length === 0) {
      throw new Error(
        "search_keywords must be a non-empty array of legal terms",
      );
    }

    if (keywords.length > 10) {
      throw new Error(
        "Maximum 10 search keywords allowed for optimal performance",
      );
    }

    const validKeywords = keywords.filter(
      (keyword) =>
        typeof keyword === "string" &&
        keyword.trim().length > 0 &&
        keyword.length <= 100,
    );

    if (validKeywords.length === 0) {
      throw new Error(
        "No valid search keywords provided. Keywords must be non-empty strings.",
      );
    }

    return validKeywords.map((k) => k.trim());
  }

  private truncateText(
    text: string | undefined,
    maxLength: number = 1000,
  ): string {
    if (!text || text.length <= maxLength) return text || "";
    return (
      text.substring(0, maxLength) +
      "... [TRUNCATED - use get_case_details with include_full_text for complete text]"
    );
  }

  private extractLegalConcepts(caseName: string): string[] {
    const commonLegalTerms = [
      "breach",
      "negligence",
      "contract",
      "warranty",
      "consumer",
      "damages",
      "liability",
    ];
    return commonLegalTerms.filter((term) =>
      caseName.toLowerCase().includes(term),
    );
  }

  private async discoverCourts(): Promise<Record<string, any>[]> {
    try {
      const allCourts: Record<string, any>[] = [];
      let page = 1;
      let hasMore = true;

      console.log("Discovering courts from CourtListener API...");

      while (hasMore && allCourts.length < 4000) {
        // Safety limit
        const response = await this.axiosInstance.get("/courts/", {
          params: { page, page_size: 200 },
        });

        const { results, next } = response.data;
        allCourts.push(...results);
        hasMore = !!next;
        page++;

        if (page % 5 === 0) {
          console.log(`Discovered ${allCourts.length} courts so far...`);
        }
      }

      console.log(`Total courts discovered: ${allCourts.length}`);
      return allCourts;
    } catch (error) {
      console.error("Failed to discover courts:", error);
      return [];
    }
  }

  private categorizeCourtsByJurisdiction(
    courts: Record<string, any>[],
  ): CourtCache {
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

    console.log(`Categorized courts:
      Total: ${categorized.all.length}
      Federal: ${categorized.federal.length}
      State: ${categorized.state.length}
      Federal Bankruptcy: ${categorized["federal-bankruptcy"].length}
      Military: ${categorized.military.length}
      Special: ${categorized.special.length}`);

    return categorized;
  }

  private async ensureCourtCache(): Promise<void> {
    const now = new Date();

    if (!this.courtCache || !this.cacheExpiry || now > this.cacheExpiry) {
      console.log("Refreshing court cache...");
      const courts = await this.discoverCourts();
      this.courtCache = this.categorizeCourtsByJurisdiction(courts);
      this.cacheExpiry = new Date(now.getTime() + this.CACHE_DURATION);
      console.log(`Cached ${this.courtCache.all.length} courts`);
    }
  }

  private findCourtsByState(stateName: string): string[] {
    if (!this.courtCache) return [];

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

    // Also check the original input before normalization
    const stateCodes = stateAbbreviations[stateName] || stateAbbreviations[stateName.replace(/[-_\s]/g, "")] || [stateName];

    return this.courtCache.state
      .filter((court) => {
        const courtId = court.id.toLowerCase();
        return stateCodes.some((code) => courtId.startsWith(code));
      })
      .map((c) => c.id);
  }

  private suggestSimilarJurisdictions(input: string): string[] {
    if (!this.courtCache) return [];

    const suggestions: string[] = [];
    const normalized = input.toLowerCase();

    // Find similar court names (limit to avoid huge lists)
    this.courtCache.all.slice(0, 100).forEach((court) => {
      if (
        court.short_name.toLowerCase().includes(normalized) ||
        court.full_name.toLowerCase().includes(normalized)
      ) {
        suggestions.push(court.id);
      }
    });

    // Add common alternatives and state name suggestions
    if (normalized.includes("fed")) suggestions.push("federal");
    if (normalized.includes("state")) suggestions.push("state");
    if (normalized.includes("supreme")) suggestions.push("scotus");
    if (normalized.includes("ca") && !normalized.includes("cal"))
      suggestions.push("california");
    if (normalized.includes("ny")) suggestions.push("new-york");
    if (normalized.includes("south") && normalized.includes("carolina"))
      suggestions.push("south-carolina");
    if (normalized.includes("north") && normalized.includes("carolina"))
      suggestions.push("north-carolina");
    if (normalized.includes("south") && normalized.includes("dakota"))
      suggestions.push("south-dakota");
    if (normalized.includes("north") && normalized.includes("dakota"))
      suggestions.push("north-dakota");
    if (normalized.includes("new") && normalized.includes("jersey"))
      suggestions.push("new-jersey");
    if (normalized.includes("new") && normalized.includes("mexico"))
      suggestions.push("new-mexico");
    if (normalized.includes("west") && normalized.includes("virginia"))
      suggestions.push("west-virginia");
    if (normalized.includes("new") && normalized.includes("hampshire"))
      suggestions.push("new-hampshire");
    if (normalized.includes("rhode") && normalized.includes("island"))
      suggestions.push("rhode-island");

    return [...new Set(suggestions)].slice(0, 5); // Limit suggestions, remove duplicates
  }

  private async resolveJurisdiction(jurisdiction: string): Promise<string[]> {
    await this.ensureCourtCache();

    if (!this.courtCache) {
      throw new Error("Court cache not available");
    }

    const normalized = jurisdiction.toLowerCase().replace(/[-_\s]/g, "");
    const lowerOriginal = jurisdiction.toLowerCase();

    // Handle special cases
    switch (normalized) {
      case "all":
        return []; // Empty = no filter = all courts

      case "federal":
        return this.courtCache.federal.map((c) => c.id);

      case "state":
        return this.courtCache.state.map((c) => c.id);

      case "federalbankruptcy":
      case "bankruptcy":
        return this.courtCache["federal-bankruptcy"].map((c) => c.id);

      case "military":
        return this.courtCache.military.map((c) => c.id);

      case "special":
        return this.courtCache.special.map((c) => c.id);
    }

    // Handle comma-separated court IDs
    if (jurisdiction.includes(",")) {
      const courtIds = jurisdiction.split(",").map((id) => id.trim());
      const validIds = courtIds.filter((id) =>
        this.courtCache!.all.some((c) => c.id === id),
      );
      return validIds;
    }

    // Handle single court ID (exact match)
    if (this.courtCache.all.some((c) => c.id === jurisdiction)) {
      return [jurisdiction];
    }

    // Handle state names - try both normalized and hyphenated versions
    let stateResults = this.findCourtsByState(lowerOriginal);
    if (stateResults.length === 0) {
      stateResults = this.findCourtsByState(normalized);
    }
    if (stateResults.length > 0) {
      return stateResults;
    }

    // Handle partial matches in court names
    const partialMatches = this.courtCache.all.filter(
      (court) =>
        court.short_name.toLowerCase().includes(normalized) ||
        court.full_name.toLowerCase().includes(normalized),
    );

    if (partialMatches.length > 0) {
      return partialMatches.slice(0, 50).map((c) => c.id); // Limit to avoid huge lists
    }

    throw new Error(`Unrecognized jurisdiction: ${jurisdiction}`);
  }

  private async searchCasesByProblem(args: SearchArgs) {
    const {
      search_keywords,
      problem_summary,
      case_type,
      date_range = "recent-2years",
      limit = 10,
      jurisdiction,
      court_level = "all",
    } = args;

    try {
      // Validate jurisdiction is provided
      if (!jurisdiction) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "Jurisdiction is required for case search",
                  message: "Please specify which jurisdiction to search",
                  supported_options: [
                    "all (search all courts)",
                    "federal (all federal courts)",
                    "state (all state courts)",
                    "california (all CA courts)",
                    "texas (all TX courts)",
                    "scotus (Supreme Court only)",
                    "ca9,ca11 (multiple specific courts)",
                  ],
                  example: {
                    search_keywords: search_keywords,
                    jurisdiction: "california",
                    court_level: "all",
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const validKeywords = this.validateSearchKeywords(search_keywords);

      // Resolve jurisdiction to court IDs
      let targetCourts: string[];
      try {
        targetCourts = await this.resolveJurisdiction(jurisdiction);
      } catch (error) {
        const suggestions = this.suggestSimilarJurisdictions(jurisdiction);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: `Unrecognized jurisdiction: ${jurisdiction}`,
                  message:
                    error instanceof Error ? error.message : String(error),
                  suggestions:
                    suggestions.length > 0
                      ? suggestions
                      : [
                          "all",
                          "federal",
                          "state",
                          "california",
                          "new-york",
                          "texas",
                        ],
                  example: {
                    search_keywords: search_keywords,
                    jurisdiction: suggestions[0] || "federal",
                    court_level: court_level,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const primaryTerms = validKeywords.slice(0, 5);
      const searchQuery = primaryTerms.map((term) => `"${term}"`).join(" OR ");

      const searchQueryFinal = searchQuery;

      let dateFilter: Record<string, string> = {};
      const currentDate = new Date();

      switch (date_range) {
        case "recent-2years":
          const twoYearsAgo = new Date(currentDate);
          twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
          dateFilter.filed_after = twoYearsAgo.toISOString().split("T")[0];
          break;
        case "established-precedent":
          const tenYearsAgo = new Date(currentDate);
          tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
          const fiveYearsAgo = new Date(currentDate);
          fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
          dateFilter.filed_after = tenYearsAgo.toISOString().split("T")[0];
          dateFilter.filed_before = fiveYearsAgo.toISOString().split("T")[0];
          break;
      }

      const params = {
        q: searchQueryFinal,
        type: "o",
        ...(targetCourts.length > 0 && { court: targetCourts.join(",") }),
        ...dateFilter,
        cited_gt: 0,
        page_size: Math.min(limit * 2, 40),
        fields: "id,case_name,court,date_filed,citation_count,snippet",
      };

      const response = await this.axiosInstance.get("/search/", { params });
      const data = response.data;

      const scoredResults = data.results.map((item: any) => {
        const text = (
          item.case_name +
          " " +
          (item.snippet || "")
        ).toLowerCase();
        const keywordScore = validKeywords.reduce((score, keyword) => {
          return score + (text.includes(keyword.toLowerCase()) ? 1 : 0);
        }, 0);

        return {
          ...item,
          relevance_score: keywordScore,
        };
      });

      const sortedResults = scoredResults
        .sort((a: any, b: any) => {
          if (a.relevance_score !== b.relevance_score) {
            return b.relevance_score - a.relevance_score;
          }
          return (b.citation_count || 0) - (a.citation_count || 0);
        })
        .slice(0, limit);

      const results = sortedResults.map((item: any) => ({
        case_id: item.id,
        case_name: item.case_name,
        court: item.court,
        date_filed: item.date_filed,
        citation_count: item.citation_count || 0,
        relevance_summary: this.truncateText(item.snippet, 200),
        keyword_matches: item.relevance_score,
        precedential_value:
          item.citation_count > 10
            ? "Strong"
            : item.citation_count > 2
              ? "Moderate"
              : "Limited",
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                search_strategy: {
                  keywords_used: validKeywords,
                  query_constructed: searchQueryFinal,
                  date_range_applied: date_range,
                  jurisdiction: jurisdiction,
                  court_level: court_level,
                  courts_searched:
                    targetCourts.length === 0
                      ? "all courts"
                      : targetCourts.length,
                },
                problem_context: problem_summary || "No summary provided",
                search_results: {
                  total_found: data.count,
                  returned_count: results.length,
                  cases: results,
                },
                usage_note:
                  results.length === limit
                    ? "Results limited for readability. Use find_similar_precedents with top cases for deeper research."
                    : "All relevant cases returned based on keyword search.",
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
                suggestion:
                  'Ensure search_keywords is an array of 1-10 legal terms. Example: ["breach of contract", "negligence", "damages"]',
                example_usage: {
                  search_keywords: ["breach of contract", "negligence"],
                  problem_summary:
                    "Contract dispute involving failure to deliver services",
                  case_type: "contract",
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  private async getCaseDetails(args: CaseDetailsArgs) {
    const { case_id, include_full_text = false } = args;

    try {
      let clusterResponse;
      try {
        clusterResponse = await this.axiosInstance.get(`/clusters/${case_id}/`);
      } catch (error) {
        const docketResponse = await this.axiosInstance.get(
          `/dockets/${case_id}/`,
        );
        const docket = docketResponse.data;

        if (docket.clusters && docket.clusters.length > 0) {
          const clusterId = docket.clusters[0].split("/").slice(-2, -1)[0];
          clusterResponse = await this.axiosInstance.get(
            `/clusters/${clusterId}/`,
          );
        } else {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    case_id,
                    error: "No opinions found for this case",
                    docket_info: {
                      case_name: docket.case_name,
                      court: docket.court,
                      date_filed: docket.date_filed,
                      nature_of_suit: docket.nature_of_suit,
                    },
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      }

      const cluster = clusterResponse.data;

      let opinions: any[] = [];
      if (cluster.sub_opinions && cluster.sub_opinions.length > 0) {
        for (const opinionUrl of cluster.sub_opinions.slice(0, 3)) {
          try {
            const opinionId = opinionUrl.split("/").slice(-2, -1)[0];
            const opinionResponse = await this.axiosInstance.get(
              `/opinions/${opinionId}/`,
              {
                params: {
                  fields: include_full_text
                    ? "id,type,author_str,plain_text,html_with_citations"
                    : "id,type,author_str,snippet",
                },
              },
            );
            opinions.push(opinionResponse.data);
          } catch (error) {
            console.error("Error fetching opinion:", error);
          }
        }
      }

      const result = {
        case_id: cluster.id,
        case_name: cluster.case_name,
        court: cluster.court,
        date_filed: cluster.date_filed,
        citation_count: cluster.citation_count || 0,
        precedential_status: cluster.precedential_status,
        judges: cluster.judges,
        opinions: opinions.map((op) => ({
          opinion_id: op.id,
          type: op.type,
          author: op.author_str,
          content: include_full_text
            ? this.truncateText(op.plain_text, 5000)
            : this.truncateText(op.snippet || "No excerpt available", 500),
        })),
        cited_by_count: cluster.citation_count,
        legal_significance:
          cluster.citation_count > 10
            ? "High"
            : cluster.citation_count > 2
              ? "Medium"
              : "Low",
      };

      if (
        !include_full_text &&
        result.opinions.some((op) => op.content.includes("TRUNCATED"))
      ) {
        (result as any).note =
          "Use include_full_text: true to get complete opinion text";
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                case_id,
                error: `Failed to retrieve case details: ${error instanceof Error ? error.message : String(error)}`,
                suggestion:
                  "Verify the case_id is correct. Use search_cases_by_problem to find valid case IDs.",
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  private async findSimilarPrecedents(args: SimilarPrecedentsArgs) {
    const {
      reference_case_id,
      legal_concepts = [],
      citation_threshold = 1,
      limit = 8,
      jurisdiction,
    } = args;

    try {
      // Validate jurisdiction is provided
      if (!jurisdiction) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error:
                    "Jurisdiction is required for finding similar precedents",
                  message: "Please specify which jurisdiction to search",
                  supported_options: [
                    "all (search all courts)",
                    "federal (all federal courts)",
                    "state (all state courts)",
                    "california (all CA courts)",
                    "texas (all TX courts)",
                    "scotus (Supreme Court only)",
                  ],
                  example: {
                    reference_case_id: reference_case_id,
                    jurisdiction: "federal",
                    legal_concepts: legal_concepts,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Resolve jurisdiction to court IDs
      let targetCourts: string[];
      try {
        targetCourts = await this.resolveJurisdiction(jurisdiction);
      } catch (error) {
        const suggestions = this.suggestSimilarJurisdictions(jurisdiction);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: `Unrecognized jurisdiction: ${jurisdiction}`,
                  message:
                    error instanceof Error ? error.message : String(error),
                  suggestions:
                    suggestions.length > 0
                      ? suggestions
                      : ["all", "federal", "state", "california", "new-york"],
                  example: {
                    reference_case_id: reference_case_id,
                    jurisdiction: suggestions[0] || "federal",
                    legal_concepts: legal_concepts,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const referenceResponse = await this.axiosInstance.get(
        `/clusters/${reference_case_id}/`,
      );
      const referenceCase = referenceResponse.data;

      const searchTerms = [
        ...legal_concepts,
        referenceCase.case_name.split(" v. ")[0],
        ...this.extractLegalConcepts(referenceCase.case_name),
      ]
        .filter(Boolean)
        .slice(0, 5);

      const searchQuery = searchTerms.join(" OR ");

      const params = {
        q: searchQuery,
        type: "o",
        ...(targetCourts.length > 0 && { court: targetCourts.join(",") }),
        cited_gt: citation_threshold - 1,
        page_size: limit + 5,
        fields: "id,case_name,court,date_filed,citation_count,snippet",
      };

      const response = await this.axiosInstance.get("/search/", { params });
      const results = response.data.results
        .filter((item: any) => item.id !== parseInt(reference_case_id))
        .slice(0, limit)
        .map((item: any) => ({
          case_id: item.id,
          case_name: item.case_name,
          court: item.court,
          date_filed: item.date_filed,
          citation_count: item.citation_count || 0,
          similarity_summary: this.truncateText(item.snippet, 150),
          precedential_value:
            item.citation_count > 10
              ? "Strong"
              : item.citation_count > 2
                ? "Moderate"
                : "Limited",
        }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                reference_case: {
                  id: referenceCase.id,
                  name: referenceCase.case_name,
                  court: referenceCase.court,
                },
                search_strategy: {
                  legal_concepts_used: searchTerms,
                  citation_threshold,
                  jurisdiction: jurisdiction,
                  courts_searched:
                    targetCourts.length === 0
                      ? "all courts"
                      : targetCourts.length,
                },
                similar_cases: results,
                analysis_note: `Found ${results.length} similar cases. Cases with higher citation counts have stronger precedential value.`,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                reference_case_id,
                error: `Cannot find similar precedents: ${error instanceof Error ? error.message : String(error)}`,
                suggestion:
                  "Verify the reference case ID. Use search_cases_by_problem to find valid case IDs first.",
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  private async analyzeCaseOutcomes(args: AnalyzeCaseOutcomesArgs) {
    const {
      case_type,
      court_level = "all",
      date_range = "last-2years",
      jurisdiction,
    } = args;

    let dateFilter: Record<string, string> = {};
    const currentDate = new Date();

    switch (date_range) {
      case "last-year":
        dateFilter.filed_after = new Date(
          currentDate.setFullYear(currentDate.getFullYear() - 1),
        )
          .toISOString()
          .split("T")[0];
        break;
      case "last-2years":
        dateFilter.filed_after = new Date(
          currentDate.setFullYear(currentDate.getFullYear() - 2),
        )
          .toISOString()
          .split("T")[0];
        break;
      case "last-5years":
        dateFilter.filed_after = new Date(
          currentDate.setFullYear(currentDate.getFullYear() - 5),
        )
          .toISOString()
          .split("T")[0];
        break;
    }

    // Validate jurisdiction is provided
    if (!jurisdiction) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "Jurisdiction is required for case outcome analysis",
                message: "Please specify which jurisdiction to analyze",
                supported_options: [
                  "all (analyze all courts)",
                  "federal (all federal courts)",
                  "state (all state courts)",
                  "california (CA state courts)",
                  "new-york (NY state courts)",
                  "scotus (Supreme Court only)",
                ],
                example: {
                  case_type: case_type,
                  jurisdiction: "federal",
                  court_level: court_level,
                  date_range: date_range,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    // Resolve jurisdiction to court IDs
    let targetCourts: string[];
    try {
      targetCourts = await this.resolveJurisdiction(jurisdiction);

      // Apply court level filtering if specific courts were resolved
      if (targetCourts.length > 0 && court_level !== "all") {
        // Filter by court level using court cache
        await this.ensureCourtCache();
        if (this.courtCache) {
          const courtsByLevel = this.courtCache.all.filter((court) => {
            if (court_level === "trial" && court.jurisdiction === "ST")
              return true;
            if (
              court_level === "appellate" &&
              (court.id.includes("app") || court.id.includes("ca"))
            )
              return true;
            if (
              court_level === "supreme" &&
              (court.id === "scotus" || court.id.includes("supreme"))
            )
              return true;
            return false;
          });
          targetCourts = targetCourts.filter((id) =>
            courtsByLevel.some((c) => c.id === id),
          );
        }
      }
    } catch (error) {
      const suggestions = this.suggestSimilarJurisdictions(jurisdiction);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: `Unrecognized jurisdiction: ${jurisdiction}`,
                message: error instanceof Error ? error.message : String(error),
                suggestions:
                  suggestions.length > 0
                    ? suggestions
                    : ["all", "federal", "state", "california", "new-york"],
                example: {
                  case_type: case_type,
                  jurisdiction: suggestions[0] || "federal",
                  court_level: court_level,
                  date_range: date_range,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    try {
      const params = {
        q: `"${case_type}"`,
        type: "r",
        ...(targetCourts.length > 0 && { court: targetCourts.join(",") }),
        ...dateFilter,
        page_size: 50,
        fields: "id,case_name,court,date_filed,date_terminated,nature_of_suit",
      };

      const response = await this.axiosInstance.get("/search/", { params });
      const cases = response.data.results;

      const outcomes = {
        total_cases: cases.length,
        terminated_cases: cases.filter((c: any) => c.date_terminated).length,
        ongoing_cases: cases.filter((c: any) => !c.date_terminated).length,
        court_breakdown: {} as Record<string, number>,
        avg_case_duration: null as number | null,
      };

      cases.forEach((case_item: any) => {
        const court = case_item.court || "unknown";
        outcomes.court_breakdown[court] =
          (outcomes.court_breakdown[court] || 0) + 1;
      });

      const terminatedCases = cases.filter(
        (c: any) => c.date_terminated && c.date_filed,
      );
      if (terminatedCases.length > 0) {
        const durations = terminatedCases
          .map((c: any) => {
            const filed = new Date(c.date_filed);
            const terminated = new Date(c.date_terminated);
            return Math.round(
              (terminated.getTime() - filed.getTime()) / (1000 * 60 * 60 * 24),
            );
          })
          .filter((d: number) => d > 0 && d < 3650);

        if (durations.length > 0) {
          outcomes.avg_case_duration = Math.round(
            durations.reduce((a, b) => a + b, 0) / durations.length,
          );
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                analysis_parameters: {
                  case_type,
                  court_level,
                  date_range,
                  jurisdiction: jurisdiction,
                  courts_analyzed:
                    targetCourts.length === 0
                      ? "all courts"
                      : targetCourts.length,
                },
                outcome_patterns: outcomes,
                success_indicators: {
                  case_closure_rate:
                    outcomes.terminated_cases > 0
                      ? Math.round(
                          (outcomes.terminated_cases / outcomes.total_cases) *
                            100,
                        ) + "%"
                      : "Insufficient data",
                  avg_duration_days: outcomes.avg_case_duration,
                  most_active_court: Object.keys(
                    outcomes.court_breakdown,
                  ).reduce(
                    (a, b) =>
                      outcomes.court_breakdown[a] > outcomes.court_breakdown[b]
                        ? a
                        : b,
                    "none",
                  ),
                },
                strategic_insight:
                  outcomes.terminated_cases > outcomes.ongoing_cases
                    ? "Most cases reach resolution - favorable for litigation"
                    : "Many cases still pending - consider alternative dispute resolution",
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                case_type,
                error: `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
                suggestion:
                  "Try a broader case_type or different date_range for better results.",
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  private async getJudgeAnalysis(args: JudgeAnalysisArgs) {
    const { judge_name, case_type, court, jurisdiction } = args;

    try {
      // Resolve jurisdiction if provided to help narrow down the judge search
      let targetCourts: string[] = [];
      if (jurisdiction && !court) {
        try {
          targetCourts = await this.resolveJurisdiction(jurisdiction);
        } catch (error) {
          // If jurisdiction resolution fails, continue without filter
          console.warn(`Could not resolve jurisdiction ${jurisdiction}, searching all judges`);
        }
      }

      const judgeParams = {
        name__icontains: judge_name,
        fields: "id,name_full,positions",
      };

      const judgeResponse = await this.axiosInstance.get("/people/", {
        params: judgeParams,
      });
      const judges = judgeResponse.data.results;

      if (judges.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  judge_name,
                  error: "Judge not found in database",
                  suggestion: "Check spelling or try last name only. If common name, specify court or jurisdiction.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // If multiple judges found and jurisdiction specified, try to filter
      let selectedJudge = judges[0];
      if (judges.length > 1 && (court || targetCourts.length > 0)) {
        // Try to find judge associated with specified court/jurisdiction
        // This is a simplified approach - could be enhanced with position analysis
        selectedJudge = judges[0]; // For now, still use first match
      }

      const judgeId = selectedJudge.id;

      const opinionParams: any = {
        author: judgeId,
        q: case_type,
        type: "o",
        page_size: 20,
        fields: "id,case_name,court,date_filed,type",
      };

      if (court) {
        opinionParams.court = court;
      } else if (targetCourts.length > 0) {
        opinionParams.court = targetCourts.join(",");
      }

      const opinionResponse = await this.axiosInstance.get("/search/", {
        params: opinionParams,
      });
      const opinions = opinionResponse.data.results;

      const analysis = {
        judge_info: {
          name: selectedJudge.name_full,
          id: selectedJudge.id,
          positions: selectedJudge.positions?.slice(-3) || [],
          multiple_matches: judges.length > 1 ? `Found ${judges.length} judges with similar names` : null,
        },
        search_parameters: {
          case_type: case_type,
          jurisdiction_filter: jurisdiction || "all courts",
          specific_court: court || null,
        },
        case_analysis: {
          total_opinions_found: opinions.length,
          opinion_types: {} as Record<string, number>,
          courts_served: {} as Record<string, number>,
          recent_cases: opinions.slice(0, 5).map((op: any) => ({
            case_name: op.case_name,
            court: op.court,
            date: op.date_filed,
            type: op.type,
          })),
        },
        strategic_insight:
          opinions.length > 5
            ? "Judge has significant experience in this area"
            : "Limited data available - consider broader search",
      };

      opinions.forEach((op: any) => {
        analysis.case_analysis.opinion_types[op.type] =
          (analysis.case_analysis.opinion_types[op.type] || 0) + 1;
        analysis.case_analysis.courts_served[op.court] =
          (analysis.case_analysis.courts_served[op.court] || 0) + 1;
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(analysis, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                judge_name,
                case_type,
                error: `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
                suggestion:
                  "Verify judge name spelling and ensure case_type is relevant",
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  private async validateCitations(args: ValidateCitationsArgs) {
    const { citations, context_text, jurisdiction } = args;

    // Resolve jurisdiction if provided
    let targetCourts: string[] = [];
    if (jurisdiction) {
      try {
        targetCourts = await this.resolveJurisdiction(jurisdiction);
      } catch (error) {
        // If jurisdiction resolution fails, continue without filter
        console.warn(`Could not resolve jurisdiction ${jurisdiction}, searching all courts`);
      }
    }

    const results = {
      validation_summary: {
        total_citations: citations.length,
        valid_citations: 0,
        invalid_citations: 0,
        jurisdiction_searched: jurisdiction || "all courts",
      },
      citation_details: [] as any[],
      related_cases: [] as any[],
    };

    for (const citation of citations.slice(0, 10)) {
      try {
        const searchParams = {
          q: `"${citation}"`,
          type: "o",
          ...(targetCourts.length > 0 && { court: targetCourts.join(",") }),
          page_size: 5,
          fields: "id,case_name,court,date_filed,citation_count,snippet",
        };

        const response = await this.axiosInstance.get("/search/", {
          params: searchParams,
        });
        const matches = response.data.results;

        if (matches.length > 0) {
          results.validation_summary.valid_citations++;
          const bestMatch = matches[0];

          results.citation_details.push({
            input_citation: citation,
            status: "valid",
            matched_case: {
              case_id: bestMatch.id,
              case_name: bestMatch.case_name,
              court: bestMatch.court,
              date_filed: bestMatch.date_filed,
              citation_count: bestMatch.citation_count,
            },
            context_relevance:
              context_text && bestMatch.snippet ? "relevant" : "needs_review",
          });

          if (matches.length > 1) {
            results.related_cases.push(
              ...matches.slice(1, 3).map((match: any) => ({
                case_id: match.id,
                case_name: match.case_name,
                relationship: "related_citation",
              })),
            );
          }
        } else {
          results.validation_summary.invalid_citations++;
          results.citation_details.push({
            input_citation: citation,
            status: "not_found",
            suggestion:
              "Check citation format or search for case name directly",
          });
        }
      } catch (error) {
        results.validation_summary.invalid_citations++;
        results.citation_details.push({
          input_citation: citation,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (citations.length > 10) {
      (results as any).note =
        `Only first 10 citations processed. Total: ${citations.length}`;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }

  private async getProceduralRequirements(args: ProceduralRequirementsArgs) {
    const { case_type, jurisdiction, court, claim_amount } = args;

    try {
      // Resolve jurisdiction to court IDs
      let targetCourts: string[];
      try {
        targetCourts = await this.resolveJurisdiction(jurisdiction);
      } catch (error) {
        const suggestions = this.suggestSimilarJurisdictions(jurisdiction);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: `Unrecognized jurisdiction: ${jurisdiction}`,
                  message: error instanceof Error ? error.message : String(error),
                  suggestions:
                    suggestions.length > 0
                      ? suggestions
                      : ["federal", "state", "california", "new-york", "texas"],
                  example: {
                    case_type: case_type,
                    jurisdiction: suggestions[0] || "federal",
                    claim_amount: claim_amount,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // If specific court provided, use it; otherwise use resolved courts
      const searchCourts = court ? [court] : targetCourts;

      // Search for procedural cases
      const searchParams = {
        q: `"${case_type}" AND (procedure OR filing OR requirement OR "civil procedure" OR "rules of court")`,
        ...(searchCourts.length > 0 && { court: searchCourts.join(",") }),
        type: "o",
        page_size: 20,
        fields: "id,case_name,court,date_filed,snippet",
        order_by: "-date_filed",
      };

      const response = await this.axiosInstance.get("/search/", {
        params: searchParams,
      });
      const proceduralCases = response.data.results.slice(0, 10);

      // Get court information if available
      await this.ensureCourtCache();
      let courtInfo = null;
      if (court && this.courtCache) {
        const foundCourt = this.courtCache.all.find((c) => c.id === court);
        if (foundCourt) {
          courtInfo = {
            court_id: foundCourt.id,
            court_name: foundCourt.full_name,
            court_type: foundCourt.jurisdiction,
          };
        }
      }

      // Determine appropriate court level based on claim amount
      let courtLevelRecommendation = null;
      if (claim_amount) {
        if (claim_amount <= 10000) {
          courtLevelRecommendation = "Small claims or limited jurisdiction court recommended";
        } else if (claim_amount <= 75000) {
          courtLevelRecommendation = "State trial court or district court recommended";
        } else {
          courtLevelRecommendation = "Superior/Supreme court or federal court may be appropriate";
        }
      }

      const requirements = {
        jurisdiction_info: {
          jurisdiction_searched: jurisdiction,
          specific_court: courtInfo,
          courts_searched: searchCourts.length === 0 ? "all courts" : searchCourts.length,
          claim_amount: claim_amount,
          court_level_recommendation: courtLevelRecommendation,
        },
        case_type: case_type,
        procedural_precedents: proceduralCases.map((case_item: any) => ({
          case_name: case_item.case_name,
          court: case_item.court,
          date: case_item.date_filed,
          procedural_insight: this.truncateText(case_item.snippet, 200),
        })),
        general_procedural_requirements: [
          "Determine proper court jurisdiction based on case type and amount",
          "File complaint/petition with required forms",
          "Pay applicable filing fees (varies by court)",
          "Serve all defendants according to local rules",
          "Include all required supporting documentation",
          "Meet applicable statute of limitations",
          "Follow local court rules for formatting and submission",
        ],
        recommended_next_steps: [
          "Review local court rules for specific filing requirements",
          "Check statute of limitations for your case type",
          "Verify court has jurisdiction over defendants",
          "Prepare all necessary documentation before filing",
          "Consider alternative dispute resolution options",
          proceduralCases.length > 0 
            ? "Review the procedural precedents above for jurisdiction-specific guidance"
            : "Research local court rules for detailed requirements",
        ],
        search_results_note: proceduralCases.length === 0
          ? "No specific procedural cases found. Consider broadening search or checking local court rules directly."
          : `Found ${proceduralCases.length} relevant procedural cases for reference.`,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(requirements, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                case_type,
                jurisdiction,
                error: `Could not retrieve procedural requirements: ${error instanceof Error ? error.message : String(error)}`,
                general_guidance: {
                  basic_steps: [
                    "Research local court rules",
                    "Prepare complaint with required elements",
                    "File with appropriate court",
                    "Pay filing fees",
                    "Serve defendants",
                    "Await response and follow court procedures",
                  ],
                  note: "Procedural requirements vary significantly by jurisdiction. Consult local court rules or legal counsel for specific requirements.",
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  private async trackLegalTrends(args: TrackLegalTrendsArgs) {
    const {
      legal_area,
      time_period = "last-year",
      trend_type = "outcomes",
    } = args;

    let dateFilter: Record<string, string> = {};
    const currentDate = new Date();

    switch (time_period) {
      case "last-6months":
        dateFilter.filed_after = new Date(
          currentDate.setMonth(currentDate.getMonth() - 6),
        )
          .toISOString()
          .split("T")[0];
        break;
      case "last-year":
        dateFilter.filed_after = new Date(
          currentDate.setFullYear(currentDate.getFullYear() - 1),
        )
          .toISOString()
          .split("T")[0];
        break;
      case "last-2years":
        dateFilter.filed_after = new Date(
          currentDate.setFullYear(currentDate.getFullYear() - 2),
        )
          .toISOString()
          .split("T")[0];
        break;
    }

    const areaQueries: Record<string, string> = {
      "consumer-protection": "consumer protection OR warranty OR defective",
      "small-claims": "small claims OR monetary damages",
      "landlord-tenant": "landlord tenant OR eviction OR rent",
      "contract-disputes": "breach of contract OR agreement",
      "warranty-claims": "warranty OR merchantability OR fitness",
    };

    const searchQuery = areaQueries[legal_area] || legal_area;

    try {
      const params = {
        q: searchQuery,
        type: trend_type === "new-precedents" ? "o" : "r",
        // No court filter - search all courts nationwide
        ...dateFilter,
        page_size: 50,
        order_by: "-date_filed",
        fields: "id,case_name,court,date_filed,date_terminated,citation_count",
      };

      const response = await this.axiosInstance.get("/search/", { params });
      const cases = response.data.results;

      const trends = {
        analysis_period: time_period,
        legal_area: legal_area,
        total_cases_found: cases.length,
        trend_analysis: {} as any,
        court_activity: {} as Record<string, number>,
        monthly_filing_pattern: {} as Record<string, number>,
        key_trends: [] as string[],
      };

      cases.forEach((case_item: any) => {
        const court = case_item.court || "unknown";
        trends.court_activity[court] = (trends.court_activity[court] || 0) + 1;

        if (case_item.date_filed) {
          const month = case_item.date_filed.substring(0, 7);
          trends.monthly_filing_pattern[month] =
            (trends.monthly_filing_pattern[month] || 0) + 1;
        }
      });

      if (trend_type === "outcomes") {
        const terminated = cases.filter((c: any) => c.date_terminated).length;
        const ongoing = cases.length - terminated;
        trends.trend_analysis = {
          case_resolution_rate:
            cases.length > 0
              ? Math.round((terminated / cases.length) * 100) + "%"
              : "0%",
          active_vs_closed: { terminated, ongoing },
        };
        trends.key_trends.push(
          terminated > ongoing
            ? "High case resolution rate"
            : "Many cases still pending",
          `Peak filing activity in court: ${Object.keys(
            trends.court_activity,
          ).reduce(
            (a, b) =>
              trends.court_activity[a] > trends.court_activity[b] ? a : b,
            "none",
          )}`,
        );
      } else if (trend_type === "new-precedents") {
        const highCitation = cases.filter(
          (c: any) => (c.citation_count || 0) > 2,
        );
        trends.trend_analysis = {
          potentially_precedential: highCitation.length,
          emerging_authority: highCitation
            .slice(0, 3)
            .map((c: any) => c.case_name),
        };
        trends.key_trends.push(
          highCitation.length > 0
            ? `${highCitation.length} cases gaining precedential status`
            : "No strong precedents emerging",
          "Monitor these cases for legal developments",
        );
      }

      const mostActiveMonths = Object.entries(trends.monthly_filing_pattern)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 3)
        .map(([month, count]) => `${month}: ${count} cases`);

      if (mostActiveMonths.length > 0) {
        trends.key_trends.push(
          `Most active filing periods: ${mostActiveMonths.join(", ")}`,
        );
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(trends, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                legal_area,
                time_period,
                trend_type,
                error: `Trend trend analysis failed: ${error instanceof Error ? error.message : String(error)}`,
                suggestion:
                  "Try a different legal area or extend the time period for more data",
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  getServer(): Server {
    return this.server;
  }
}

// Export default function that matches Smithery's expected format
export default function createServer({
  config,
}: {
  config: z.infer<typeof configSchema>;
}) {
  const apiKey =
    config.courtlistener_api_key || process.env.COURTLISTENER_API_KEY || "";
  const server = new CourtListenerMCPServer(apiKey);
  return server.getServer();
}
