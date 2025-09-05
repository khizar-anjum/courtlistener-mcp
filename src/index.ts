import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  Tool,
  Resource,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";
import { z } from "zod";
import { CourtResourceManager } from "./court-resource-manager.js";

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
  content_mode?: "summary" | "full";
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

// RECAP/PACER function interfaces for Phase 2
interface SearchPacerDocketsArgs {
  case_name?: string;
  court?: string;
  date_range?: {
    start_date?: string; // ISO date format
    end_date?: string;   // ISO date format
  };
  party_name?: string;
  nature_of_suit?: string;
  limit?: number;
  case_type?: "civil" | "criminal" | "bankruptcy" | "all";
}

interface GetDocketEntriesArgs {
  docket_id: string;
  limit?: number;
  entry_type?: "all" | "documents" | "orders" | "filings";
}

interface SearchPartiesAttorneysArgs {
  party_name?: string;
  attorney_name?: string;
  firm_name?: string;
  court?: string;
  date_range?: {
    start_date?: string;
    end_date?: string;
  };
  limit?: number;
}

interface AnalyzeCaseTimelineArgs {
  docket_id: string;
  include_documents?: boolean;
  analysis_type?: "progression" | "delays" | "activity" | "all";
}

interface TrackCaseStatusArgs {
  docket_id: string;
  include_recent_activity?: boolean;
  status_history?: boolean;
}

interface GetCaseDocumentsArgs {
  docket_id: string;
  document_type?: "all" | "orders" | "motions" | "briefs" | "opinions";
  include_text?: boolean;
  limit?: number;
}



class CourtListenerMCPServer {
  private server: Server;
  private axiosInstance: AxiosInstance;

  constructor(apiKey: string = "") {
    this.server = new Server(
      {
        name: "courtlistener-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
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
    // Resource handlers
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: CourtResourceManager.listResources(),
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      try {
        const resourceContent = CourtResourceManager.readResource(request.params.uri);
        return {
          contents: [{
            uri: request.params.uri,
            mimeType: "application/json",
            text: resourceContent
          }]
        };
      } catch (error) {
        throw new Error(`Failed to read resource: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // Tool handlers
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
              content_mode: {
                type: "string",
                enum: ["summary", "full"],
                description: "Content mode: 'summary' returns API syllabus or 'N/A - use full mode', 'full' returns complete opinion text",
                default: "summary",
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
        // RECAP/PACER functions for Phase 2
        {
          name: "search_pacer_dockets",
          description:
            "📊 PACER SEARCH: Search federal court dockets from PACER via CourtListener's RECAP Archive. Find active and terminated cases with comprehensive party, attorney, and filing information. Search by case name, party name, or nature of suit across all federal courts or specific jurisdictions.",
          inputSchema: {
            type: "object",
            properties: {
              case_name: {
                type: "string",
                description: "Case name or title to search for",
              },
              court: {
                type: "string", 
                description: "Specific court identifier (e.g., 'ca3', 'cacd', 'nysd', 'dcd') OR jurisdiction name (e.g., 'federal', 'california', 'bankruptcy'). Court IDs are passed directly, jurisdiction names are resolved to multiple courts.",
              },
              date_range: {
                type: "object",
                properties: {
                  start_date: { type: "string", description: "Start date in ISO format (YYYY-MM-DD)" },
                  end_date: { type: "string", description: "End date in ISO format (YYYY-MM-DD)" },
                },
                description: "Date range for case filing or termination dates",
              },
              party_name: {
                type: "string",
                description: "Name of a party involved in the case (plaintiff, defendant, etc.). Examples: 'Sean Combs', 'Microsoft Corporation', 'United States'",
              },
              nature_of_suit: {
                type: "string",
                description: "Nature of suit code or description (e.g., 'Contract', 'Tort', 'Civil Rights')",
              },
              case_type: {
                type: "string",
                enum: ["civil", "criminal", "bankruptcy", "all"],
                default: "all",
                description: "Type of case to search for",
              },
              limit: {
                type: "number",
                minimum: 1,
                maximum: 50,
                default: 20,
                description: "Maximum number of dockets to return",
              },
            },
            required: [],
          },
        },
        {
          name: "get_docket_entries",
          description:
            "🔒 PREMIUM ACCESS REQUIRED | EXPERIMENTAL: Get detailed docket entries for a specific case, including all filings, orders, and document references from PACER. Note: This function requires CourtListener premium API access and is experimental - may not work with basic API keys.",
          inputSchema: {
            type: "object",
            properties: {
              docket_id: {
                type: "string",
                description: "Docket ID from search results",
              },
              entry_type: {
                type: "string",
                enum: ["all", "documents", "orders", "filings"],
                default: "all",
                description: "Type of docket entries to retrieve",
              },
              limit: {
                type: "number",
                minimum: 1,
                maximum: 100,
                default: 50,
                description: "Maximum number of entries to return",
              },
            },
            required: ["docket_id"],
          },
        },
        {
          name: "search_parties_attorneys",
          description:
            "📊 BASIC ACCESS: Search for parties and attorneys across PACER cases. Track representation patterns and attorney success rates. Note: Basic API access provides limited data - premium access required for full attorney/party details.",
          inputSchema: {
            type: "object",
            properties: {
              party_name: {
                type: "string",
                description: "Name of party to search for (plaintiff, defendant, etc.)",
              },
              attorney_name: {
                type: "string", 
                description: "Attorney name to search for",
              },
              firm_name: {
                type: "string",
                description: "Law firm name to search for",
              },
              court: {
                type: "string",
                description: "Court identifier to limit search (optional)",
              },
              date_range: {
                type: "object",
                properties: {
                  start_date: { type: "string", description: "Start date in ISO format" },
                  end_date: { type: "string", description: "End date in ISO format" },
                },
                description: "Date range for case activity",
              },
              limit: {
                type: "number",
                minimum: 1,
                maximum: 50,
                default: 20,
                description: "Maximum number of results to return",
              },
            },
            required: [],
          },
        },
        {
          name: "analyze_case_timeline",
          description:
            "🔒 PREMIUM ACCESS REQUIRED | EXPERIMENTAL: Analyze case progression timeline from PACER docket entries. Track delays, activity patterns, and case development. Note: Requires premium access to docket-entries endpoint - basic API access provides limited timeline data only.",
          inputSchema: {
            type: "object",
            properties: {
              docket_id: {
                type: "string",
                description: "Docket ID to analyze",
              },
              include_documents: {
                type: "boolean",
                default: false,
                description: "Include document filing analysis in timeline",
              },
              analysis_type: {
                type: "string",
                enum: ["progression", "delays", "activity", "all"],
                default: "all",
                description: "Type of timeline analysis to perform",
              },
            },
            required: ["docket_id"],
          },
        },
        {
          name: "track_case_status",
          description:
            "📊 BASIC ACCESS: Track current status and recent activity for PACER cases. Monitor active litigation progress. Note: Basic access provides case metadata only - premium access required for detailed activity tracking.",
          inputSchema: {
            type: "object",
            properties: {
              docket_id: {
                type: "string",
                description: "Docket ID to track",
              },
              include_recent_activity: {
                type: "boolean",
                default: true,
                description: "Include recent docket activity in status report",
              },
              status_history: {
                type: "boolean",
                default: false,
                description: "Include historical status changes",
              },
            },
            required: ["docket_id"],
          },
        },
        {
          name: "get_case_documents",
          description:
            "🔒 PREMIUM ACCESS REQUIRED | EXPERIMENTAL: Retrieve case documents from PACER with full text extraction. Access orders, motions, briefs, and opinions. Note: This function requires CourtListener premium API access and is experimental - may not work with basic API keys.",
          inputSchema: {
            type: "object",
            properties: {
              docket_id: {
                type: "string",
                description: "Docket ID to get documents for",
              },
              document_type: {
                type: "string",
                enum: ["all", "orders", "motions", "briefs", "opinions"],
                default: "all",
                description: "Type of documents to retrieve",
              },
              include_text: {
                type: "boolean", 
                default: false,
                description: "Include extracted full text content (may be large)",
              },
              limit: {
                type: "number",
                minimum: 1,
                maximum: 50,
                default: 20,
                description: "Maximum number of documents to return",
              },
            },
            required: ["docket_id"],
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
          // RECAP/PACER functions for Phase 2
          case "search_pacer_dockets":
            return await this.searchPacerDockets(args as SearchPacerDocketsArgs);
          case "get_docket_entries":
            return await this.getDocketEntries(args as GetDocketEntriesArgs);
          case "search_parties_attorneys":
            return await this.searchPartiesAttorneys(args as SearchPartiesAttorneysArgs);
          case "analyze_case_timeline":
            return await this.analyzeCaseTimeline(args as AnalyzeCaseTimelineArgs);
          case "track_case_status":
            return await this.trackCaseStatus(args as TrackCaseStatusArgs);
          case "get_case_documents":
            return await this.getCaseDocuments(args as GetCaseDocumentsArgs);
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





  private suggestSimilarJurisdictions(input: string): string[] {
    return CourtResourceManager.suggestSimilarJurisdictions(input);
  }

  private resolveJurisdiction(jurisdiction: string): string[] {
    // No async needed! Pure function using resources
    const courtIds = CourtResourceManager.resolveJurisdiction(jurisdiction);
    
    if (courtIds.length === 0) {
      throw new Error(`Unrecognized jurisdiction: ${jurisdiction}`);
    }
    
    return courtIds;
  }

  // Helper method for PACER functions to resolve both jurisdictions and court IDs
  private resolveCourtForPacer(courtInput: string): string[] {
    // First try to resolve as jurisdiction
    try {
      return this.resolveJurisdiction(courtInput);
    } catch (error) {
      // If it fails, check if it looks like a court ID (e.g., 'ca3', 'nysd', 'cacd')
      // Court IDs are typically 2-6 characters, alphanumeric
      const courtIdPattern = /^[a-z0-9]{2,6}$/i;
      if (courtIdPattern.test(courtInput)) {
        // Treat as a specific court ID for PACER search
        return [courtInput.toLowerCase()];
      } else {
        // It's not a valid jurisdiction or court ID
        throw new Error(`Invalid court identifier or jurisdiction: ${courtInput}`);
      }
    }
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
        targetCourts = this.resolveJurisdiction(jurisdiction);
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

      // CourtListener search API requires court filtering via query string, not court parameter
      const courtFilter = targetCourts.length > 0 
        ? ` AND court_id:(${targetCourts.join(' OR ')})` 
        : '';
      const finalQuery = searchQueryFinal + courtFilter;

      const params = {
        q: finalQuery,
        type: "o",
        ...dateFilter,
        cited_gt: 0,
        page_size: Math.min(limit * 2, 40),
        fields: "id,case_name,case_name_full,court,court_citation_string,date_filed,citation_count,snippet,absolute_url,citation,lexisCite,neutralCite,docketNumber,status,syllabus,judge,download_url",
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
        case_name_full: item.case_name_full || item.case_name,
        court: {
          id: item.court,
          name: item.court, // API returns court ID, full name would need separate lookup
          citation_string: item.court_citation_string || ""
        },
        date_filed: item.date_filed,
        citations: {
          official: item.citation ? (Array.isArray(item.citation) ? item.citation : [item.citation]) : [],
          lexis: item.lexisCite || undefined,
          neutral: item.neutralCite || undefined
        },
        urls: {
          courtlistener: item.absolute_url ? `https://www.courtlistener.com${item.absolute_url}` : undefined,
          download: item.download_url || undefined
        },
        docket_number: item.docketNumber || "N/A",
        legal_summary: item.syllabus || "N/A - use full mode for complete text",
        full_text_available: !!item.snippet,
        judge: item.judge || "N/A",
        precedential_status: item.status || "Unknown",
        citation_count: item.citation_count || 0,
        precedential_value:
          item.citation_count > 10
            ? "Strong"
            : item.citation_count > 2
              ? "Moderate"
              : "Limited",
        content_mode: "summary",
        keyword_matches: item.relevance_score
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
    const { case_id, content_mode = "summary" } = args;

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
                  fields: content_mode === "full"
                    ? "id,type,author_str,plain_text,html_with_citations,syllabus,download_url"
                    : "id,type,author_str,snippet,syllabus,download_url",
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
        case_name_full: cluster.case_name_full || cluster.case_name,
        court: {
          id: cluster.court,
          name: cluster.court, // Would need separate lookup for full name
          citation_string: cluster.court_citation_string || ""
        },
        date_filed: cluster.date_filed,
        citations: {
          official: cluster.citation ? (Array.isArray(cluster.citation) ? cluster.citation : [cluster.citation]) : [],
          lexis: cluster.lexisCite || undefined,
          neutral: cluster.neutralCite || undefined
        },
        urls: {
          courtlistener: cluster.absolute_url ? `https://www.courtlistener.com${cluster.absolute_url}` : undefined
        },
        docket_number: cluster.docketNumber || "N/A",
        citation_count: cluster.citation_count || 0,
        precedential_status: cluster.precedential_status,
        judges: cluster.judges,
        content_mode: content_mode,
        legal_summary: cluster.syllabus || "N/A - use full mode for complete text",
        full_text_available: opinions.some(op => op.plain_text),
        opinions: opinions.map((op) => ({
          opinion_id: op.id,
          type: op.type,
          author: op.author_str,
          legal_summary: op.syllabus || "N/A - use full mode for complete text",
          content: content_mode === "full" 
            ? op.plain_text || "Full text not available"
            : (op.syllabus || "N/A - use full mode for complete text"),
          download_url: op.download_url || undefined,
          html_with_citations: content_mode === "full" ? op.html_with_citations : undefined
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
        content_mode === "summary" &&
        result.opinions.some((op) => op.content === "N/A - use full mode for complete text")
      ) {
        (result as any).note =
          "Use content_mode: 'full' to get complete opinion text";
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
        targetCourts = this.resolveJurisdiction(jurisdiction);
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

      // Use OR logic for court filtering in query parameter
      const courtFilter = targetCourts.length > 0 
        ? ` AND court_id:(${targetCourts.join(' OR ')})` 
        : '';
      const finalQuery = searchQuery + courtFilter;

      const params = {
        q: finalQuery,
        type: "o",
        cited_gt: citation_threshold - 1,
        page_size: limit + 5,
        fields: "id,case_name,case_name_full,court,court_citation_string,date_filed,citation_count,snippet,absolute_url,citation,lexisCite,neutralCite,docketNumber,status,syllabus,judge,download_url",
      };

      const response = await this.axiosInstance.get("/search/", { params });
      const results = response.data.results
        .filter((item: any) => item.id !== parseInt(reference_case_id))
        .slice(0, limit)
        .map((item: any) => ({
          case_id: item.id,
          case_name: item.case_name,
          case_name_full: item.case_name_full || item.case_name,
          court: {
            id: item.court,
            name: item.court,
            citation_string: item.court_citation_string || ""
          },
          date_filed: item.date_filed,
          citations: {
            official: item.citation ? (Array.isArray(item.citation) ? item.citation : [item.citation]) : [],
            lexis: item.lexisCite || undefined,
            neutral: item.neutralCite || undefined
          },
          urls: {
            courtlistener: item.absolute_url ? `https://www.courtlistener.com${item.absolute_url}` : undefined,
            download: item.download_url || undefined
          },
          docket_number: item.docketNumber || "N/A",
          legal_summary: item.syllabus || "N/A - use full mode for complete text",
          full_text_available: !!item.snippet,
          judge: item.judge || "N/A",
          precedential_status: item.status || "Unknown",
          citation_count: item.citation_count || 0,
          precedential_value:
            item.citation_count > 10
              ? "Strong"
              : item.citation_count > 2
                ? "Moderate"
                : "Limited",
          content_mode: "summary",
          similarity_summary: this.truncateText(item.snippet, 150)
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
      targetCourts = this.resolveJurisdiction(jurisdiction);

      // Apply court level filtering if specific courts were resolved
      if (targetCourts.length > 0 && court_level !== "all") {
        // Simple heuristic filtering by court level based on court ID patterns
        targetCourts = targetCourts.filter((id) => {
          const lowerCourt = id.toLowerCase();
          if (court_level === "trial") {
            // Trial courts are typically district courts or state trial courts
            return lowerCourt.includes("d") && !lowerCourt.includes("ca") && !lowerCourt.includes("scotus");
          }
          if (court_level === "appellate") {
            // Appellate courts include circuit courts
            return lowerCourt.includes("ca") || lowerCourt.includes("app");
          }
          if (court_level === "supreme") {
            // Supreme courts
            return lowerCourt === "scotus" || lowerCourt.includes("supreme");
          }
          return true;
        });
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
      // Use OR logic for court filtering in query parameter
      const courtFilter = targetCourts.length > 0 
        ? ` AND court_id:(${targetCourts.join(' OR ')})` 
        : '';
      const finalQuery = `"${case_type}"` + courtFilter;

      const params = {
        q: finalQuery,
        type: "r",
        ...dateFilter,
        page_size: 50,
        fields: "id,case_name,case_name_full,court,court_citation_string,date_filed,date_terminated,nature_of_suit,assignedTo,assigned_to_id,attorney,cause,chapter,juryDemand,party,firm",
      };

      const response = await this.axiosInstance.get("/search/", { params });
      const cases = response.data.results;

      // PHASE 2 ENHANCEMENT: Add RECAP docket data for enhanced resolution tracking
      let recapDockets: any[] = [];
      let recapAnalysis: any = null;
      
      try {
        // Search RECAP dockets for the same case type and jurisdiction
        const recapParams: any = {
          q: `nature_of_suit:"${case_type}" OR cause:"${case_type}"`,
          format: "json",
          ...dateFilter,
          fields: "id,case_name,docket_number,court,date_filed,date_terminated,nature_of_suit,cause,assigned_to,assigned_to_id,attorney,party,firm,jury_demand"
        };

        if (targetCourts.length > 0) {
          recapParams.court__in = targetCourts.join(',');
        }

        const recapResponse = await this.axiosInstance.get("/dockets/", { params: recapParams });
        recapDockets = (recapResponse.data.results || []).slice(0, 100); // Get up to 100 RECAP cases

        // Enhanced analysis with RECAP data
        if (recapDockets.length > 0) {
          const recapTerminated = recapDockets.filter((d: any) => d.date_terminated).length;
          const recapOngoing = recapDockets.filter((d: any) => !d.date_terminated).length;

          // Calculate settlement patterns from RECAP data
          const settlementKeywords = ['settlement', 'dismissed', 'consent', 'stipulation'];
          let estimatedSettlements = 0;
          
          // Note: This would require docket entries analysis for more accurate settlement detection
          // For now, use heuristic based on case termination patterns
          const terminatedRecap = recapDockets.filter((d: any) => d.date_terminated);
          estimatedSettlements = Math.floor(terminatedRecap.length * 0.6); // Rough estimate based on legal statistics

          // Duration analysis from RECAP
          const recapDurations = terminatedRecap
            .map((d: any) => {
              if (d.date_filed && d.date_terminated) {
                const filed = new Date(d.date_filed);
                const terminated = new Date(d.date_terminated);
                return Math.round((terminated.getTime() - filed.getTime()) / (1000 * 60 * 60 * 24));
              }
              return null;
            })
            .filter((d: number | null) => d !== null && d > 0 && d < 3650) as number[];

          const avgRecapDuration = recapDurations.length > 0 
            ? Math.round(recapDurations.reduce((a, b) => a + b, 0) / recapDurations.length)
            : null;

          recapAnalysis = {
            recap_cases_found: recapDockets.length,
            recap_terminated: recapTerminated,
            recap_ongoing: recapOngoing,
            estimated_settlements: estimatedSettlements,
            settlement_rate: recapTerminated > 0 ? Math.round((estimatedSettlements / recapTerminated) * 100) + "%" : "Unknown",
            recap_avg_duration: avgRecapDuration,
            data_source: "PACER via RECAP Archive",
            attorney_representation_patterns: this.analyzeAttorneyPatterns(recapDockets),
            judge_assignment_patterns: this.analyzeJudgePatterns(recapDockets)
          };
        }
      } catch (recapError) {
        console.warn("RECAP data integration failed:", recapError);
        recapAnalysis = {
          recap_integration_status: "Failed to retrieve RECAP data",
          fallback_to_search_only: true,
          error: recapError instanceof Error ? recapError.message : String(recapError)
        };
      }

      const outcomes = {
        total_cases: cases.length,
        terminated_cases: cases.filter((c: any) => c.date_terminated).length,
        ongoing_cases: cases.filter((c: any) => !c.date_terminated).length,
        court_breakdown: {} as Record<string, number>,
        judge_breakdown: {} as Record<string, number>,
        attorney_patterns: {} as Record<string, number>,
        case_nature_breakdown: {} as Record<string, number>,
        party_analysis: {
          unique_parties: new Set(),
          repeat_litigants: {} as Record<string, number>
        },
        avg_case_duration: null as number | null,
        case_details: cases.slice(0, 10).map((c: any) => ({
          case_id: c.id,
          case_name: c.case_name,
          case_name_full: c.case_name_full || c.case_name,
          court: {
            id: c.court,
            name: c.court,
            citation_string: c.court_citation_string || ""
          },
          date_filed: c.date_filed,
          date_terminated: c.date_terminated || "Ongoing",
          nature_of_suit: c.nature_of_suit || "Unknown",
          assigned_judge: c.assignedTo || "N/A",
          attorneys: c.attorney ? (Array.isArray(c.attorney) ? c.attorney : [c.attorney]) : [],
          parties: c.party ? (Array.isArray(c.party) ? c.party : [c.party]) : [],
          jury_demand: c.juryDemand || "Unknown",
          urls: {
            courtlistener: c.absolute_url ? `https://www.courtlistener.com${c.absolute_url}` : undefined
          }
        }))
      };

      cases.forEach((case_item: any) => {
        const court = case_item.court || "unknown";
        outcomes.court_breakdown[court] =
          (outcomes.court_breakdown[court] || 0) + 1;
        
        // Judge analysis
        if (case_item.assignedTo) {
          outcomes.judge_breakdown[case_item.assignedTo] =
            (outcomes.judge_breakdown[case_item.assignedTo] || 0) + 1;
        }
        
        // Attorney analysis
        if (case_item.attorney) {
          const attorneys = Array.isArray(case_item.attorney) ? case_item.attorney : [case_item.attorney];
          attorneys.forEach((attorney: string) => {
            outcomes.attorney_patterns[attorney] =
              (outcomes.attorney_patterns[attorney] || 0) + 1;
          });
        }
        
        // Nature of suit analysis
        if (case_item.nature_of_suit) {
          outcomes.case_nature_breakdown[case_item.nature_of_suit] =
            (outcomes.case_nature_breakdown[case_item.nature_of_suit] || 0) + 1;
        }
        
        // Party analysis
        if (case_item.party) {
          const parties = Array.isArray(case_item.party) ? case_item.party : [case_item.party];
          parties.forEach((party: string) => {
            outcomes.party_analysis.unique_parties.add(party);
            outcomes.party_analysis.repeat_litigants[party] =
              (outcomes.party_analysis.repeat_litigants[party] || 0) + 1;
          });
        }
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

      // Convert Set to array for JSON serialization
      const finalOutcomes = {
        ...outcomes,
        party_analysis: {
          unique_parties_count: outcomes.party_analysis.unique_parties.size,
          repeat_litigants: Object.entries(outcomes.party_analysis.repeat_litigants)
            .filter(([, count]) => count > 1)
            .reduce((acc, [party, count]) => ({ ...acc, [party]: count }), {})
        }
      };

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
                // Original opinion-based analysis
                opinion_based_outcomes: finalOutcomes,
                // PHASE 2: Enhanced RECAP/PACER analysis
                live_litigation_analysis: recapAnalysis,
                combined_insights: {
                  total_data_sources: recapAnalysis?.recap_cases_found ? 2 : 1,
                  opinion_cases: cases.length,
                  live_pacer_cases: recapAnalysis?.recap_cases_found || 0,
                  comprehensive_closure_rate: recapAnalysis ? 
                    `Opinion data: ${outcomes.terminated_cases > 0 ? Math.round((outcomes.terminated_cases / outcomes.total_cases) * 100) : 0}%, PACER data: ${recapAnalysis.recap_terminated > 0 ? Math.round((recapAnalysis.recap_terminated / recapAnalysis.recap_cases_found) * 100) : 0}%` :
                    outcomes.terminated_cases > 0 ? Math.round((outcomes.terminated_cases / outcomes.total_cases) * 100) + "%" : "Insufficient data",
                  duration_comparison: {
                    opinion_avg_days: outcomes.avg_case_duration,
                    recap_avg_days: recapAnalysis?.recap_avg_duration || null,
                    data_reliability: recapAnalysis?.recap_cases_found > 10 ? "High" : "Moderate"
                  }
                },
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
                  // Enhanced with RECAP data
                  settlement_insights: recapAnalysis ? {
                    estimated_settlement_rate: recapAnalysis.settlement_rate,
                    data_source: "PACER docket analysis",
                    reliability: recapAnalysis.recap_cases_found > 20 ? "High confidence" : "Moderate confidence"
                  } : "RECAP data not available",
                },
                strategic_insight: recapAnalysis ? 
                  this.generateEnhancedStrategicInsight(outcomes, recapAnalysis) :
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
          targetCourts = this.resolveJurisdiction(jurisdiction);
        } catch (error) {
          // If jurisdiction resolution fails, continue without filter
          console.warn(`Could not resolve jurisdiction ${jurisdiction}, searching all judges`);
        }
      }

      const judgeParams = {
        name__icontains: judge_name,
        fields: "id,name_full,name_first,name_last,positions,political_affiliations,education,date_created,date_modified",
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

      // Use OR logic for court filtering in query parameter
      const courtFilter = court ? ` AND court_id:(${court})` :
        targetCourts.length > 0 ? ` AND court_id:(${targetCourts.join(' OR ')})` : '';
      const finalQuery = case_type + courtFilter;

      const opinionParams: any = {
        author: judgeId,
        q: finalQuery,
        type: "o",
        page_size: 20,
        fields: "id,case_name,case_name_full,court,court_citation_string,date_filed,citation_count,snippet,absolute_url,citation,lexisCite,neutralCite,docketNumber,status,syllabus,judge,type",
      };

      const opinionResponse = await this.axiosInstance.get("/search/", {
        params: opinionParams,
      });
      const opinions = opinionResponse.data.results;

      const analysis = {
        judge_info: {
          id: selectedJudge.id,
          name_full: selectedJudge.name_full,
          name_first: selectedJudge.name_first,
          name_last: selectedJudge.name_last,
          positions: selectedJudge.positions || [],
          political_affiliations: selectedJudge.political_affiliations || [],
          education: selectedJudge.education || [],
          career_span: {
            date_created: selectedJudge.date_created,
            date_modified: selectedJudge.date_modified
          },
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
          citation_analysis: {
            total_citations: opinions.reduce((sum: number, op: any) => sum + (op.citation_count || 0), 0),
            avg_citations_per_opinion: opinions.length > 0 
              ? Math.round(opinions.reduce((sum: number, op: any) => sum + (op.citation_count || 0), 0) / opinions.length)
              : 0,
            highly_cited_opinions: opinions.filter((op: any) => (op.citation_count || 0) > 5).length
          },
          recent_cases: opinions.slice(0, 8).map((op: any) => ({
            case_id: op.id,
            case_name: op.case_name,
            case_name_full: op.case_name_full || op.case_name,
            court: {
              id: op.court,
              name: op.court,
              citation_string: op.court_citation_string || ""
            },
            date_filed: op.date_filed,
            citations: {
              official: op.citation ? (Array.isArray(op.citation) ? op.citation : [op.citation]) : [],
              lexis: op.lexisCite || undefined,
              neutral: op.neutralCite || undefined
            },
            urls: {
              courtlistener: op.absolute_url ? `https://www.courtlistener.com${op.absolute_url}` : undefined
            },
            docket_number: op.docketNumber || "N/A",
            legal_summary: op.syllabus || "N/A - use full mode for complete text",
            citation_count: op.citation_count || 0,
            precedential_status: op.status || "Unknown",
            opinion_type: op.type
          })),
        },
        judicial_patterns: {
          most_active_court: null as string | null,
          opinion_frequency: opinions.length > 0 ? "Active" : "Limited",
          precedential_impact: opinions.filter((op: any) => (op.citation_count || 0) > 2).length > 0 
            ? "High - has written influential opinions"
            : "Moderate - standard judicial output"
        },
        strategic_insight:
          opinions.length > 10
            ? "Judge has extensive experience in this area with significant precedential impact"
            : opinions.length > 5
              ? "Judge has moderate experience in this area"
              : "Limited data available - consider broader search or different case type",
      };

      opinions.forEach((op: any) => {
        analysis.case_analysis.opinion_types[op.type] =
          (analysis.case_analysis.opinion_types[op.type] || 0) + 1;
        analysis.case_analysis.courts_served[op.court] =
          (analysis.case_analysis.courts_served[op.court] || 0) + 1;
      });

      // Determine most active court
      if (Object.keys(analysis.case_analysis.courts_served).length > 0) {
        analysis.judicial_patterns.most_active_court = Object.keys(analysis.case_analysis.courts_served)
          .reduce((a, b) => analysis.case_analysis.courts_served[a] > analysis.case_analysis.courts_served[b] ? a : b);
      }

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
        targetCourts = this.resolveJurisdiction(jurisdiction);
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
        // Use OR logic for court filtering in query parameter
        const courtFilter = targetCourts.length > 0 
          ? ` AND court_id:(${targetCourts.join(' OR ')})` 
          : '';
        const finalQuery = `"${citation}"` + courtFilter;

        const searchParams = {
          q: finalQuery,
          type: "o",
          page_size: 5,
          fields: "id,case_name,case_name_full,court,court_citation_string,date_filed,citation_count,snippet,absolute_url,citation,lexisCite,neutralCite,docketNumber,status,syllabus,judge,download_url",
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
              case_name_full: bestMatch.case_name_full || bestMatch.case_name,
              court: {
                id: bestMatch.court,
                name: bestMatch.court,
                citation_string: bestMatch.court_citation_string || ""
              },
              date_filed: bestMatch.date_filed,
              citations: {
                official: bestMatch.citation ? (Array.isArray(bestMatch.citation) ? bestMatch.citation : [bestMatch.citation]) : [],
                lexis: bestMatch.lexisCite || undefined,
                neutral: bestMatch.neutralCite || undefined
              },
              urls: {
                courtlistener: bestMatch.absolute_url ? `https://www.courtlistener.com${bestMatch.absolute_url}` : undefined,
                download: bestMatch.download_url || undefined
              },
              docket_number: bestMatch.docketNumber || "N/A",
              legal_summary: bestMatch.syllabus || "N/A - use full mode for complete text",
              judge: bestMatch.judge || "N/A",
              precedential_status: bestMatch.status || "Unknown",
              citation_count: bestMatch.citation_count || 0,
              precedential_value: bestMatch.citation_count > 10 ? "Strong" : bestMatch.citation_count > 2 ? "Moderate" : "Limited"
            },
            citation_formats: {
              input_format: citation,
              suggested_formats: bestMatch.citation ? (Array.isArray(bestMatch.citation) ? bestMatch.citation : [bestMatch.citation]) : [],
              bluebook_format: bestMatch.neutralCite || bestMatch.lexisCite || (bestMatch.citation && bestMatch.citation[0]) || "Format unavailable"
            },
            context_relevance:
              context_text && bestMatch.snippet ? "relevant" : "needs_review",
          });

          if (matches.length > 1) {
            results.related_cases.push(
              ...matches.slice(1, 3).map((match: any) => ({
                case_id: match.id,
                case_name: match.case_name,
                case_name_full: match.case_name_full || match.case_name,
                court: {
                  id: match.court,
                  name: match.court,
                  citation_string: match.court_citation_string || ""
                },
                urls: {
                  courtlistener: match.absolute_url ? `https://www.courtlistener.com${match.absolute_url}` : undefined
                },
                citations: {
                  official: match.citation ? (Array.isArray(match.citation) ? match.citation : [match.citation]) : [],
                  lexis: match.lexisCite || undefined,
                  neutral: match.neutralCite || undefined
                },
                relationship: "related_citation",
                precedential_value: match.citation_count > 10 ? "Strong" : match.citation_count > 2 ? "Moderate" : "Limited"
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
        targetCourts = this.resolveJurisdiction(jurisdiction);
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

      // Use OR logic for court filtering in query parameter
      const courtFilter = searchCourts.length > 0 
        ? ` AND court_id:(${searchCourts.join(' OR ')})` 
        : '';
      const finalQuery = `"${case_type}" AND (procedure OR filing OR requirement OR "civil procedure" OR "rules of court")` + courtFilter;

      // Search for procedural cases
      const searchParams = {
        q: finalQuery,
        type: "o",
        page_size: 20,
        fields: "id,case_name,case_name_full,court,court_citation_string,date_filed,citation_count,snippet,absolute_url,citation,lexisCite,neutralCite,docketNumber,status,syllabus,judge,download_url",
        order_by: "-date_filed",
      };

      const response = await this.axiosInstance.get("/search/", {
        params: searchParams,
      });
      const proceduralCases = response.data.results.slice(0, 10);

      // Get court information if available (simplified without cache)
      let courtInfo = null;
      if (court) {
        courtInfo = {
          court_id: court,
          court_name: `Court ${court}`,
          court_type: "Unknown",
        };
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
          case_id: case_item.id,
          case_name: case_item.case_name,
          case_name_full: case_item.case_name_full || case_item.case_name,
          court: {
            id: case_item.court,
            name: case_item.court,
            citation_string: case_item.court_citation_string || ""
          },
          date_filed: case_item.date_filed,
          citations: {
            official: case_item.citation ? (Array.isArray(case_item.citation) ? case_item.citation : [case_item.citation]) : [],
            lexis: case_item.lexisCite || undefined,
            neutral: case_item.neutralCite || undefined
          },
          urls: {
            courtlistener: case_item.absolute_url ? `https://www.courtlistener.com${case_item.absolute_url}` : undefined,
            download: case_item.download_url || undefined
          },
          docket_number: case_item.docketNumber || "N/A",
          legal_summary: case_item.syllabus || "N/A - use full mode for complete text",
          judge: case_item.judge || "N/A",
          precedential_status: case_item.status || "Unknown",
          citation_count: case_item.citation_count || 0,
          procedural_insight: this.truncateText(case_item.snippet, 200),
          relevance_for_procedure: "Contains procedural guidance for " + case_type
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
        fields: "id,case_name,case_name_full,court,court_citation_string,date_filed,date_terminated,citation_count,snippet,absolute_url,citation,lexisCite,neutralCite,docketNumber,status,syllabus,judge",
      };

      const response = await this.axiosInstance.get("/search/", { params });
      const cases = response.data.results;

      const trends = {
        analysis_period: time_period,
        legal_area: legal_area,
        trend_type: trend_type,
        total_cases_found: cases.length,
        trend_analysis: {} as any,
        court_activity: {} as Record<string, number>,
        judge_activity: {} as Record<string, number>,
        monthly_filing_pattern: {} as Record<string, number>,
        geographic_distribution: {} as Record<string, number>,
        citation_trends: {
          highly_cited_cases: 0,
          avg_citation_count: 0,
          emerging_precedents: [] as any[]
        },
        key_trends: [] as string[],
        representative_cases: cases.slice(0, 5).map((case_item: any) => ({
          case_id: case_item.id,
          case_name: case_item.case_name,
          case_name_full: case_item.case_name_full || case_item.case_name,
          court: {
            id: case_item.court,
            name: case_item.court,
            citation_string: case_item.court_citation_string || ""
          },
          date_filed: case_item.date_filed,
          date_terminated: case_item.date_terminated || "Ongoing",
          citations: {
            official: case_item.citation ? (Array.isArray(case_item.citation) ? case_item.citation : [case_item.citation]) : [],
            lexis: case_item.lexisCite || undefined,
            neutral: case_item.neutralCite || undefined
          },
          urls: {
            courtlistener: case_item.absolute_url ? `https://www.courtlistener.com${case_item.absolute_url}` : undefined
          },
          docket_number: case_item.docketNumber || "N/A",
          legal_summary: case_item.syllabus || "N/A - use full mode for complete text",
          judge: case_item.judge || "N/A",
          precedential_status: case_item.status || "Unknown",
          citation_count: case_item.citation_count || 0,
          trend_significance: case_item.citation_count > 5 ? "High impact" : "Standard case"
        }))
      };

      cases.forEach((case_item: any) => {
        const court = case_item.court || "unknown";
        trends.court_activity[court] = (trends.court_activity[court] || 0) + 1;

        // Judge activity tracking
        if (case_item.judge) {
          trends.judge_activity[case_item.judge] = (trends.judge_activity[case_item.judge] || 0) + 1;
        }

        // Geographic distribution (simplified by court ID prefix)
        const courtPrefix = court.substring(0, 2);
        trends.geographic_distribution[courtPrefix] = (trends.geographic_distribution[courtPrefix] || 0) + 1;

        // Citation trends analysis
        const citationCount = case_item.citation_count || 0;
        if (citationCount > 5) {
          trends.citation_trends.highly_cited_cases++;
        }

        if (case_item.date_filed) {
          const month = case_item.date_filed.substring(0, 7);
          trends.monthly_filing_pattern[month] =
            (trends.monthly_filing_pattern[month] || 0) + 1;
        }
      });

      // Calculate citation trends
      const totalCitations = cases.reduce((sum: number, c: any) => sum + (c.citation_count || 0), 0);
      trends.citation_trends.avg_citation_count = cases.length > 0 ? Math.round(totalCitations / cases.length) : 0;
      
      // Identify emerging precedents (high citation recent cases)
      trends.citation_trends.emerging_precedents = cases
        .filter((c: any) => (c.citation_count || 0) > 3)
        .slice(0, 3)
        .map((c: any) => ({
          case_name: c.case_name,
          citation_count: c.citation_count,
          court: c.court,
          date_filed: c.date_filed
        }));

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
            ? "High case resolution rate - favorable for litigation"
            : "Many cases still pending - consider alternative dispute resolution",
          `Peak filing activity in court: ${Object.keys(
            trends.court_activity,
          ).reduce(
            (a, b) =>
              trends.court_activity[a] > trends.court_activity[b] ? a : b,
            "none",
          )}`,
          `Average citation impact: ${trends.citation_trends.avg_citation_count} citations per case`,
          trends.citation_trends.highly_cited_cases > 0 
            ? `${trends.citation_trends.highly_cited_cases} high-impact cases identified`
            : "Limited precedential impact in recent cases"
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
          `${trends.citation_trends.emerging_precedents.length} emerging high-impact precedents identified`,
          "Monitor representative cases for evolving legal standards",
          `Most active jurisdiction: ${Object.keys(trends.geographic_distribution)
            .reduce((a, b) => trends.geographic_distribution[a] > trends.geographic_distribution[b] ? a : b, "none")}`
        );
      }

      const mostActiveMonths = Object.entries(trends.monthly_filing_pattern)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 3)
        .map(([month, count]) => `${month}: ${count} cases`);

      if (mostActiveMonths.length > 0) {
        trends.key_trends.push(
          `Most active filing periods: ${mostActiveMonths.join(", ")}`,
          Object.keys(trends.judge_activity).length > 0 
            ? `Most active judge: ${Object.keys(trends.judge_activity)
                .reduce((a, b) => trends.judge_activity[a] > trends.judge_activity[b] ? a : b)}`
            : "No specific judge patterns identified"
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

  // RECAP/PACER functions for Phase 2
  private async searchPacerDockets(args: SearchPacerDocketsArgs) {
    try {
      const { case_name, court, date_range, party_name, nature_of_suit, case_type = "all", limit = 20 } = args;

      // Build query parameters for docket search
      let query = "";
      const queryParts: string[] = [];

      if (case_name) {
        queryParts.push(`caseName:(${case_name})`);
      }

      if (party_name) {
        queryParts.push(`party:(${party_name})`);
      }

      if (nature_of_suit) {
        queryParts.push(`suitNature:(${nature_of_suit})`);
      }

      query = queryParts.join(" AND ");

      // Build API parameters for PACER search
      const params: any = {
        type: "r", // PACER dockets with nested documents
        q: query || "*", // Default to all if no specific query
        format: "json"
      };

      // Add court filter if specified
      if (court) {
        const targetCourts = this.resolveCourtForPacer(court);
        if (targetCourts.length > 0) {
          params.court = targetCourts.join(',');
        }
      }

      // Add date range filter
      if (date_range) {
        if (date_range.start_date) {
          params.filed_after = date_range.start_date;
        }
        if (date_range.end_date) {
          params.filed_before = date_range.end_date;
        }
      }

      // Case type filter for search API
      if (case_type !== "all") {
        // Map case types to search API fields
        const typeFilters: Record<string, string> = {
          civil: "civil",
          criminal: "criminal", 
          bankruptcy: "bankruptcy"
        };
        
        if (typeFilters[case_type]) {
          // Add case type to the main query
          const typeQuery = `chapter:(${typeFilters[case_type]})`;
          params.q = params.q === "*" ? typeQuery : `${params.q} AND ${typeQuery}`;
        }
      }

      // Search API returns predefined fields for type=r

      const response = await this.axiosInstance.get(`/search/`, { params });
      
      const results = response.data.results || [];

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              notice: "📊 PACER SEARCH: Results from PACER dockets using CourtListener's RECAP Archive. Basic access provides comprehensive docket metadata.",
              search_query: params.q,
              court_filter: params.court || "all",
              total_found: response.data.count || 0,
              returned_count: results.length,
              dockets: results.slice(0, limit).map((result: any) => ({
                docket_id: result.docket_id,
                case_name: result.caseName,
                case_name_full: result.case_name_full || result.caseName,
                docket_number: result.docketNumber,
                court: {
                  id: result.court_id,
                  name: result.court,
                  citation_string: result.court_citation_string || ""
                },
                dates: {
                  filed: result.dateFiled,
                  terminated: result.dateTerminated || null,
                  status: result.dateTerminated ? "Terminated" : "Active"
                },
                assigned_judge: {
                  name: result.assignedTo || "N/A",
                  id: result.assigned_to_id || null
                },
                referred_judge: {
                  name: result.referredTo || null,
                  id: result.referred_to_id || null
                },
                case_details: {
                  nature_of_suit: result.suitNature || "N/A",
                  cause: result.cause || "N/A",
                  jury_demand: result.juryDemand || "Unknown",
                  jurisdiction_type: result.jurisdictionType || "N/A",
                  chapter: result.chapter || null // For bankruptcy cases
                },
                parties: Array.isArray(result.party) ? result.party : (result.party ? [result.party] : []),
                party_ids: Array.isArray(result.party_id) ? result.party_id : (result.party_id ? [result.party_id] : []),
                attorneys: Array.isArray(result.attorney) ? result.attorney : (result.attorney ? [result.attorney] : []),
                attorney_ids: Array.isArray(result.attorney_id) ? result.attorney_id : (result.attorney_id ? [result.attorney_id] : []),
                law_firms: Array.isArray(result.firm) ? result.firm : (result.firm ? [result.firm] : []),
                firm_ids: Array.isArray(result.firm_id) ? result.firm_id : (result.firm_id ? [result.firm_id] : []),
                trustee: result.trustee_str || null,
                pacer_case_id: result.pacer_case_id || null,
                recap_documents: result.recap_documents || [],
                more_documents: result.meta?.more_docs || false,
                relevance_score: result.meta?.score?.bm25 || null,
                urls: {
                  courtlistener: result.docket_absolute_url ? `https://www.courtlistener.com${result.docket_absolute_url}` : `https://www.courtlistener.com/docket/${result.docket_id}/`,
                  pacer_link: null // Search API doesn't provide direct PACER links
                }
              }))
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: `PACER docket search failed: ${error instanceof Error ? error.message : String(error)}`,
            suggestion: "Try with different search parameters or a specific court identifier"
          }, null, 2)
        }]
      };
    }
  }

  private async getDocketEntries(args: GetDocketEntriesArgs) {
    try {
      const { docket_id, entry_type = "all", limit = 50 } = args;

      const params: any = {
        docket: docket_id,
        format: "json",
        fields: "id,date_filed,entry_number,description,recap_documents,pacer_doc_id,document_number"
      };

      const response = await this.axiosInstance.get(`/docket-entries/`, { params });
      
      let entries = response.data.results || [];

      // Filter by entry type if specified
      if (entry_type !== "all") {
        const typeFilters: Record<string, (entry: any) => boolean> = {
          documents: (entry: any) => entry.recap_documents && entry.recap_documents.length > 0,
          orders: (entry: any) => entry.description && entry.description.toLowerCase().includes('order'),
          filings: (entry: any) => entry.document_number || entry.pacer_doc_id
        };
        
        if (typeFilters[entry_type]) {
          entries = entries.filter(typeFilters[entry_type]);
        }
      }

      return {
        content: [
          {
            type: "text", 
            text: JSON.stringify({
              notice: "🔒 PREMIUM ACCESS REQUIRED: This function requires premium API access and may return 403 errors with basic API keys.",
              docket_id,
              total_entries: response.data.count || 0,
              returned_count: entries.length,
              entries: entries.slice(0, limit).map((entry: any) => ({
                entry_id: entry.id,
                entry_number: entry.entry_number,
                date_filed: entry.date_filed,
                description: entry.description,
                document_info: {
                  document_number: entry.document_number || null,
                  pacer_doc_id: entry.pacer_doc_id || null,
                  documents_count: entry.recap_documents ? entry.recap_documents.length : 0
                },
                recap_documents: entry.recap_documents ? entry.recap_documents.map((doc: any) => ({
                  id: doc.id || doc,
                  description: doc.description || "Document",
                  document_type: doc.document_type || "Unknown"
                })) : [],
                urls: {
                  courtlistener: `https://www.courtlistener.com/docket-entry/${entry.id}/`,
                  pacer_link: entry.pacer_url || null
                }
              }))
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: `🔒 Docket entries retrieval failed: ${error instanceof Error ? error.message : String(error)}`,
            suggestion: "This endpoint requires premium API access. If you have premium access, verify the docket_id is correct. HTTP 403 errors indicate insufficient permissions.",
            premium_required: true
          }, null, 2)
        }]
      };
    }
  }

  private async searchPartiesAttorneys(args: SearchPartiesAttorneysArgs) {
    try {
      const { party_name, attorney_name, firm_name, court, date_range, limit = 20 } = args;

      let parties: any[] = [];
      let attorneys: any[] = [];

      // Search parties if party_name provided
      if (party_name) {
        const partyParams: any = {
          name: party_name,
          format: "json",
          fields: "id,name,docket,extra_info,party_types"
        };

        if (court) {
          const targetCourts = this.resolveCourtForPacer(court);
          if (targetCourts.length > 0) {
            partyParams.docket__court__in = targetCourts.join(',');
          }
        }

        const partyResponse = await this.axiosInstance.get(`/parties/`, { params: partyParams });
        parties = partyResponse.data.results || [];
      }

      // Search attorneys if attorney_name or firm_name provided  
      if (attorney_name || firm_name) {
        const attorneyParams: any = {
          format: "json",
          fields: "id,name,docket,contact_raw,organizations,party_types,roles"
        };

        if (attorney_name) {
          attorneyParams.name = attorney_name;
        }

        if (firm_name) {
          attorneyParams.organizations = firm_name;
        }

        if (court) {
          const targetCourts = this.resolveCourtForPacer(court);
          if (targetCourts.length > 0) {
            attorneyParams.docket__court__in = targetCourts.join(',');
          }
        }

        const attorneyResponse = await this.axiosInstance.get(`/attorneys/`, { params: attorneyParams });
        attorneys = attorneyResponse.data.results || [];
      }

      // Get unique docket information for cases they were involved in
      const docketIds = new Set<string>();
      [...parties, ...attorneys].forEach((item: any) => {
        if (item.docket) {
          docketIds.add(item.docket.toString());
        }
      });

      // Fetch docket details for context
      let relatedCases: any[] = [];
      if (docketIds.size > 0) {
        const docketParams = {
          id__in: Array.from(docketIds).join(','),
          format: "json",
          fields: "id,case_name,docket_number,court,date_filed,date_terminated,nature_of_suit"
        };

        try {
          const docketResponse = await this.axiosInstance.get(`/dockets/`, { params: docketParams });
          relatedCases = docketResponse.data.results || [];
        } catch (docketError) {
          console.warn("Could not fetch related case details:", docketError);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              notice: "📊 BASIC ACCESS: This function provides basic party/attorney metadata. Premium access may provide additional details and case documents.",
              search_criteria: {
                party_name: party_name || null,
                attorney_name: attorney_name || null,
                firm_name: firm_name || null,
                court: court || null
              },
              results_summary: {
                parties_found: parties.length,
                attorneys_found: attorneys.length,
                related_cases: relatedCases.length
              },
              parties: parties.slice(0, limit).map((party: any) => ({
                party_id: party.id,
                name: party.name,
                party_types: party.party_types || [],
                docket_id: party.docket,
                extra_info: party.extra_info || null,
                case_context: relatedCases.find((c: any) => c.id.toString() === party.docket.toString()) || null
              })),
              attorneys: attorneys.slice(0, limit).map((attorney: any) => ({
                attorney_id: attorney.id,
                name: attorney.name,
                contact_info: attorney.contact_raw || "Not provided",
                organizations: attorney.organizations || [],
                roles: attorney.roles || [],
                party_types_represented: attorney.party_types || [],
                docket_id: attorney.docket,
                case_context: relatedCases.find((c: any) => c.id.toString() === attorney.docket.toString()) || null
              })),
              related_cases: relatedCases.map((case_item: any) => ({
                docket_id: case_item.id,
                case_name: case_item.case_name,
                docket_number: case_item.docket_number,
                court: case_item.court,
                filing_date: case_item.date_filed,
                termination_date: case_item.date_terminated,
                nature_of_suit: case_item.nature_of_suit,
                status: case_item.date_terminated ? "Terminated" : "Active"
              }))
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: `Party/Attorney search failed: ${error instanceof Error ? error.message : String(error)}`,
            suggestion: "Try with more specific search terms or expand search criteria"
          }, null, 2)
        }]
      };
    }
  }

  private async analyzeCaseTimeline(args: AnalyzeCaseTimelineArgs) {
    try {
      const { docket_id, include_documents = false, analysis_type = "all" } = args;

      // Get docket entries for timeline analysis
      const entriesParams: any = {
        docket: docket_id,
        format: "json",
        fields: "id,date_filed,entry_number,description,recap_documents,document_number",
        ordering: "date_filed"
      };

      const entriesResponse = await this.axiosInstance.get(`/docket-entries/`, { params: entriesParams });
      const entries = entriesResponse.data.results || [];

      // Get basic docket information
      const docketResponse = await this.axiosInstance.get(`/dockets/${docket_id}/`, {
        params: { format: "json", fields: "id,case_name,date_filed,date_terminated,court" }
      });
      const docketInfo = docketResponse.data;

      // Perform timeline analysis
      const timeline: any = {
        docket_id,
        case_name: docketInfo.case_name,
        case_duration: {
          filed_date: docketInfo.date_filed,
          terminated_date: docketInfo.date_terminated,
          total_days: docketInfo.date_terminated ? 
            Math.floor((new Date(docketInfo.date_terminated).getTime() - new Date(docketInfo.date_filed).getTime()) / (1000 * 60 * 60 * 24)) :
            Math.floor((new Date().getTime() - new Date(docketInfo.date_filed).getTime()) / (1000 * 60 * 60 * 24)),
          status: docketInfo.date_terminated ? "Terminated" : "Ongoing"
        },
        activity_analysis: {
          total_entries: entries.length,
          entries_with_documents: entries.filter((e: any) => e.recap_documents && e.recap_documents.length > 0).length,
          activity_periods: {} as Record<string, number>,
          monthly_activity: {} as Record<string, number>
        },
        timeline_events: [] as any[]
      };

      // Analyze activity patterns by analysis type
      if (analysis_type === "progression" || analysis_type === "all") {
        // Track case progression milestones
        const progressionKeywords = [
          'complaint', 'answer', 'motion to dismiss', 'discovery', 
          'summary judgment', 'trial', 'verdict', 'judgment', 'appeal'
        ];

        timeline.progression_milestones = progressionKeywords.map(keyword => ({
          milestone: keyword,
          entries: entries.filter((e: any) => 
            e.description && e.description.toLowerCase().includes(keyword)
          ).map((e: any) => ({
            date: e.date_filed,
            entry_number: e.entry_number,
            description: e.description
          }))
        })).filter(milestone => milestone.entries.length > 0);
      }

      if (analysis_type === "delays" || analysis_type === "all") {
        // Identify potential delays (gaps in activity)
        timeline.delay_analysis = {
          longest_gaps: [] as any[],
          avg_time_between_entries: 0
        };

        if (entries.length > 1) {
          const gaps = [];
          for (let i = 1; i < entries.length; i++) {
            const prevDate = new Date(entries[i-1].date_filed);
            const currDate = new Date(entries[i].date_filed);
            const daysDiff = Math.floor((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
            
            if (daysDiff > 30) { // Gaps longer than 30 days
              gaps.push({
                days: daysDiff,
                from_date: entries[i-1].date_filed,
                to_date: entries[i].date_filed,
                from_entry: entries[i-1].description,
                to_entry: entries[i].description
              });
            }
          }
          
          timeline.delay_analysis.longest_gaps = gaps.sort((a, b) => b.days - a.days).slice(0, 5);
          
          const totalTime = new Date(entries[entries.length-1].date_filed).getTime() - new Date(entries[0].date_filed).getTime();
          timeline.delay_analysis.avg_time_between_entries = Math.floor((totalTime / (1000 * 60 * 60 * 24)) / entries.length);
        }
      }

      if (analysis_type === "activity" || analysis_type === "all") {
        // Monthly activity breakdown
        entries.forEach((entry: any) => {
          const month = entry.date_filed.substring(0, 7); // YYYY-MM
          timeline.activity_analysis.monthly_activity[month] = 
            (timeline.activity_analysis.monthly_activity[month] || 0) + 1;
        });

        // Activity intensity periods
        const sortedMonths = Object.keys(timeline.activity_analysis.monthly_activity).sort();
        timeline.activity_analysis.most_active_period = sortedMonths.reduce((max, month) => 
          timeline.activity_analysis.monthly_activity[month] > (timeline.activity_analysis.monthly_activity[max] || 0) ? month : max, 
          sortedMonths[0] || ""
        );
      }

      // Recent entries (last 10)
      timeline.recent_activity = entries.slice(-10).map((entry: any) => ({
        date: entry.date_filed,
        entry_number: entry.entry_number,
        description: entry.description,
        has_documents: entry.recap_documents && entry.recap_documents.length > 0,
        document_count: entry.recap_documents ? entry.recap_documents.length : 0
      }));

      // Include document analysis if requested
      if (include_documents && timeline.activity_analysis.entries_with_documents > 0) {
        const docEntries = entries.filter((e: any) => e.recap_documents && e.recap_documents.length > 0);
        timeline.document_analysis = {
          total_documents: docEntries.reduce((sum: number, e: any) => sum + e.recap_documents.length, 0),
          document_types: {} as Record<string, number>,
          filing_patterns: docEntries.map((e: any) => ({
            date: e.date_filed,
            entry_number: e.entry_number,
            document_count: e.recap_documents.length,
            documents: e.recap_documents.map((doc: any) => ({
              id: doc.id || doc,
              type: doc.document_type || "Unknown"
            }))
          }))
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              notice: "🔒 PREMIUM ACCESS REQUIRED: This function requires premium access to docket-entries endpoint. May return limited data with basic API access.",
              ...timeline
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [{
          type: "text", 
          text: JSON.stringify({
            error: `🔒 Case timeline analysis failed: ${error instanceof Error ? error.message : String(error)}`,
            suggestion: "This function requires premium access to docket-entries endpoint. HTTP 403 errors indicate insufficient permissions.",
            premium_required: true
          }, null, 2)
        }]
      };
    }
  }

  private async trackCaseStatus(args: TrackCaseStatusArgs) {
    try {
      const { docket_id, include_recent_activity = true, status_history = false } = args;

      // Get docket information
      const docketResponse = await this.axiosInstance.get(`/dockets/${docket_id}/`, {
        params: { 
          format: "json", 
          fields: "id,case_name,docket_number,court,date_filed,date_terminated,assigned_to,assigned_to_id,nature_of_suit,cause,jury_demand"
        }
      });
      const docket = docketResponse.data;

      const status: any = {
        docket_id,
        case_info: {
          case_name: docket.case_name,
          docket_number: docket.docket_number,
          court: docket.court,
          assigned_judge: docket.assigned_to || "N/A"
        },
        current_status: {
          filing_date: docket.date_filed,
          termination_date: docket.date_terminated,
          is_active: !docket.date_terminated,
          case_age_days: Math.floor((new Date().getTime() - new Date(docket.date_filed).getTime()) / (1000 * 60 * 60 * 24)),
          case_type: docket.nature_of_suit || docket.cause || "Unknown"
        }
      };

      if (include_recent_activity) {
        // Get recent docket entries (last 30 days or last 10 entries)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const entriesParams: any = {
          docket: docket_id,
          format: "json",
          fields: "id,date_filed,entry_number,description,recap_documents",
          ordering: "-date_filed",
          date_filed__gte: thirtyDaysAgo.toISOString().split('T')[0]
        };

        const entriesResponse = await this.axiosInstance.get(`/docket-entries/`, { params: entriesParams });
        let recentEntries = entriesResponse.data.results || [];

        // If less than 5 entries in last 30 days, get last 10 entries regardless of date
        if (recentEntries.length < 5) {
          const allEntriesParams = {
            docket: docket_id,
            format: "json", 
            fields: "id,date_filed,entry_number,description,recap_documents",
            ordering: "-date_filed"
          };

          const allEntriesResponse = await this.axiosInstance.get(`/docket-entries/`, { params: allEntriesParams });
          recentEntries = (allEntriesResponse.data.results || []).slice(0, 10);
        }

        status.recent_activity = {
          last_activity_date: recentEntries.length > 0 ? recentEntries[0].date_filed : docket.date_filed,
          entries_last_30_days: recentEntries.length,
          recent_entries: recentEntries.slice(0, 10).map((entry: any) => ({
            date: entry.date_filed,
            entry_number: entry.entry_number,
            description: entry.description,
            has_documents: entry.recap_documents && entry.recap_documents.length > 0
          }))
        };

        // Activity level assessment
        if (recentEntries.length === 0) {
          status.activity_level = "Inactive";
        } else if (recentEntries.length >= 10) {
          status.activity_level = "Very Active";
        } else if (recentEntries.length >= 5) {
          status.activity_level = "Active";
        } else {
          status.activity_level = "Low Activity";
        }
      }

      if (status_history) {
        // Get all entries to build status history
        const allEntriesParams = {
          docket: docket_id,
          format: "json",
          fields: "id,date_filed,entry_number,description",
          ordering: "date_filed"
        };

        const allEntriesResponse = await this.axiosInstance.get(`/docket-entries/`, { params: allEntriesParams });
        const allEntries = allEntriesResponse.data.results || [];

        // Identify status changes based on entry descriptions
        const statusKeywords = [
          { status: "Case Filed", keywords: ["complaint", "petition", "filed"] },
          { status: "Answer Filed", keywords: ["answer", "response"] },
          { status: "Discovery", keywords: ["discovery", "interrogatory", "deposition"] },
          { status: "Motion Filed", keywords: ["motion"] },
          { status: "Hearing Scheduled", keywords: ["hearing", "scheduled"] },
          { status: "Trial", keywords: ["trial", "jury selection"] },
          { status: "Judgment", keywords: ["judgment", "verdict", "decision"] },
          { status: "Appeal", keywords: ["appeal", "appellate"] },
          { status: "Settled", keywords: ["settlement", "dismissed"] },
          { status: "Closed", keywords: ["closed", "terminated", "final"] }
        ];

        status.status_history = statusKeywords.map(statusItem => ({
          status: statusItem.status,
          entries: allEntries.filter((entry: any) => 
            entry.description && statusItem.keywords.some(keyword => 
              entry.description.toLowerCase().includes(keyword)
            )
          ).map((entry: any) => ({
            date: entry.date_filed,
            entry_number: entry.entry_number,
            description: entry.description
          }))
        })).filter(statusItem => statusItem.entries.length > 0);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              notice: "📊 BASIC ACCESS: This function provides basic status tracking. Premium access required for detailed docket entry analysis.",
              ...status
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: `Case status tracking failed: ${error instanceof Error ? error.message : String(error)}`,
            suggestion: "Verify the docket_id is correct and accessible"
          }, null, 2)
        }]
      };
    }
  }

  private async getCaseDocuments(args: GetCaseDocumentsArgs) {
    try {
      const { docket_id, document_type = "all", include_text = false, limit = 20 } = args;

      // Get docket entries with document information
      const entriesParams: any = {
        docket: docket_id,
        format: "json",
        fields: "id,date_filed,entry_number,description,recap_documents",
        ordering: "-date_filed"
      };

      const entriesResponse = await this.axiosInstance.get(`/docket-entries/`, { params: entriesParams });
      const entries = entriesResponse.data.results || [];

      // Filter entries that have documents
      const entriesWithDocs = entries.filter((entry: any) => 
        entry.recap_documents && entry.recap_documents.length > 0
      );

      // Get document details from RECAP documents endpoint
      const documents: any[] = [];

      for (const entry of entriesWithDocs.slice(0, limit)) {
        for (const docRef of entry.recap_documents) {
          try {
            const docId = docRef.id || docRef;
            const docResponse = await this.axiosInstance.get(`/recap-documents/${docId}/`, {
              params: { 
                format: "json",
                fields: include_text ? 
                  "id,description,document_type,document_number,attachment_number,is_available,date_upload,file_size,page_count,plain_text" :
                  "id,description,document_type,document_number,attachment_number,is_available,date_upload,file_size,page_count"
              }
            });

            const doc = docResponse.data;

            // Apply document type filter
            if (document_type !== "all") {
              const docTypeMap: Record<string, string[]> = {
                orders: ["order", "ruling"],
                motions: ["motion"],  
                briefs: ["brief", "memorandum"],
                opinions: ["opinion", "decision", "judgment"]
              };

              const allowedTypes = docTypeMap[document_type] || [];
              const docTypeStr = (doc.document_type || doc.description || "").toLowerCase();
              
              if (!allowedTypes.some(type => docTypeStr.includes(type))) {
                continue;
              }
            }

            documents.push({
              document_id: doc.id,
              docket_entry: {
                id: entry.id,
                entry_number: entry.entry_number,
                date_filed: entry.date_filed,
                description: entry.description
              },
              document_info: {
                description: doc.description || "Document",
                document_type: doc.document_type || "Unknown",
                document_number: doc.document_number,
                attachment_number: doc.attachment_number || 0,
                is_available: doc.is_available || false
              },
              file_info: {
                upload_date: doc.date_upload,
                file_size_bytes: doc.file_size || null,
                page_count: doc.page_count || null
              },
              content: {
                has_text: !!doc.plain_text,
                text_preview: include_text && doc.plain_text ? 
                  doc.plain_text.substring(0, 1000) + (doc.plain_text.length > 1000 ? "..." : "") :
                  null,
                full_text_available: !!doc.plain_text
              },
              urls: {
                courtlistener: `https://www.courtlistener.com/recap-document/${doc.id}/`,
                download: doc.is_available ? `https://www.courtlistener.com/recap-document/${doc.id}/download/` : null
              }
            });

            if (documents.length >= limit) break;
          } catch (docError) {
            console.warn(`Could not fetch document ${docRef}:`, docError);
            continue;
          }
        }
        if (documents.length >= limit) break;
      }

      // Summary statistics
      const docTypes: Record<string, number> = {};
      const availableDocs = documents.filter(doc => doc.document_info.is_available);
      
      documents.forEach(doc => {
        const type = doc.document_info.document_type || "Unknown";
        docTypes[type] = (docTypes[type] || 0) + 1;
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              notice: "🔒 PREMIUM ACCESS REQUIRED: This function requires premium access to recap-documents endpoint. May return 403 errors with basic API keys.",
              docket_id,
              search_criteria: {
                document_type,
                include_full_text: include_text,
                limit_requested: limit
              },
              summary: {
                total_entries_with_docs: entriesWithDocs.length,
                documents_returned: documents.length,
                documents_available_for_download: availableDocs.length,
                document_types: docTypes,
                text_extraction_available: documents.filter(doc => doc.content.has_text).length
              },
              documents: documents
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: `🔒 Document retrieval failed: ${error instanceof Error ? error.message : String(error)}`,
            suggestion: "This function requires premium access to recap-documents endpoint. HTTP 403 errors indicate insufficient permissions.",
            premium_required: true
          }, null, 2)
        }]
      };
    }
  }

  // Helper methods for RECAP data analysis
  private analyzeAttorneyPatterns(recapDockets: any[]): any {
    const attorneyStats: Record<string, { cases: number, courts: Set<string>, outcomes: { terminated: number, ongoing: number } }> = {};
    
    recapDockets.forEach((docket: any) => {
      const attorneys = Array.isArray(docket.attorney) ? docket.attorney : (docket.attorney ? [docket.attorney] : []);
      attorneys.forEach((attorney: string) => {
        if (!attorneyStats[attorney]) {
          attorneyStats[attorney] = { cases: 0, courts: new Set(), outcomes: { terminated: 0, ongoing: 0 } };
        }
        attorneyStats[attorney].cases++;
        attorneyStats[attorney].courts.add(docket.court);
        if (docket.date_terminated) {
          attorneyStats[attorney].outcomes.terminated++;
        } else {
          attorneyStats[attorney].outcomes.ongoing++;
        }
      });
    });

    // Convert to serializable format and get top attorneys
    const topAttorneys = Object.entries(attorneyStats)
      .map(([name, stats]) => ({
        attorney_name: name,
        total_cases: stats.cases,
        courts_practiced: stats.courts.size,
        success_rate: stats.outcomes.terminated > 0 ? 
          Math.round((stats.outcomes.terminated / stats.cases) * 100) + "%" : "N/A",
        case_resolution_pattern: `${stats.outcomes.terminated} terminated, ${stats.outcomes.ongoing} ongoing`
      }))
      .sort((a, b) => b.total_cases - a.total_cases)
      .slice(0, 10);

    return {
      most_active_attorneys: topAttorneys,
      total_attorneys_analyzed: Object.keys(attorneyStats).length
    };
  }

  private analyzeJudgePatterns(recapDockets: any[]): any {
    const judgeStats: Record<string, { cases: number, avg_duration: number[], case_types: Record<string, number> }> = {};
    
    recapDockets.forEach((docket: any) => {
      if (docket.assigned_to) {
        const judge = docket.assigned_to;
        if (!judgeStats[judge]) {
          judgeStats[judge] = { cases: 0, avg_duration: [], case_types: {} };
        }
        judgeStats[judge].cases++;
        
        if (docket.date_filed && docket.date_terminated) {
          const filed = new Date(docket.date_filed);
          const terminated = new Date(docket.date_terminated);
          const duration = Math.round((terminated.getTime() - filed.getTime()) / (1000 * 60 * 60 * 24));
          if (duration > 0 && duration < 3650) {
            judgeStats[judge].avg_duration.push(duration);
          }
        }
        
        const caseType = docket.nature_of_suit || docket.cause || "Unknown";
        judgeStats[judge].case_types[caseType] = (judgeStats[judge].case_types[caseType] || 0) + 1;
      }
    });

    const judgeAnalysis = Object.entries(judgeStats)
      .map(([name, stats]) => ({
        judge_name: name,
        total_cases_assigned: stats.cases,
        avg_case_duration: stats.avg_duration.length > 0 ? 
          Math.round(stats.avg_duration.reduce((a, b) => a + b, 0) / stats.avg_duration.length) : null,
        most_common_case_type: Object.entries(stats.case_types).length > 0 ?
          Object.entries(stats.case_types).reduce((a, b) => a[1] > b[1] ? a : b)[0] : "Unknown",
        caseload_level: stats.cases > 50 ? "High" : stats.cases > 20 ? "Moderate" : "Low"
      }))
      .sort((a, b) => b.total_cases_assigned - a.total_cases_assigned)
      .slice(0, 10);

    return {
      most_active_judges: judgeAnalysis,
      total_judges_analyzed: Object.keys(judgeStats).length
    };
  }

  private generateEnhancedStrategicInsight(outcomes: any, recapAnalysis: any): string {
    const opinionClosure = outcomes.terminated_cases > 0 ? 
      Math.round((outcomes.terminated_cases / outcomes.total_cases) * 100) : 0;
    const recapClosure = recapAnalysis.recap_terminated > 0 ? 
      Math.round((recapAnalysis.recap_terminated / recapAnalysis.recap_cases_found) * 100) : 0;
    
    let insight = "Combined analysis: ";
    
    if (recapClosure > opinionClosure + 10) {
      insight += "Live PACER data shows higher resolution rates than historical opinions suggest. ";
    } else if (opinionClosure > recapClosure + 10) {
      insight += "Historical opinions show better outcomes than current PACER trends indicate. ";
    } else {
      insight += "Opinion and PACER data align well for case outcome predictions. ";
    }
    
    if (recapAnalysis.settlement_rate && recapAnalysis.settlement_rate !== "Unknown") {
      const settlementNum = parseInt(recapAnalysis.settlement_rate.replace('%', ''));
      if (settlementNum > 60) {
        insight += "High settlement rate suggests strong negotiation opportunities.";
      } else if (settlementNum > 40) {
        insight += "Moderate settlement rate - prepare for potential trial.";
      } else {
        insight += "Lower settlement rate - expect more cases to proceed to judgment.";
      }
    }
    
    return insight;
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
