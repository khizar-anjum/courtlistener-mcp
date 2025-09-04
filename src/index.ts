import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";
import dotenv from "dotenv";

dotenv.config();

const COURTLISTENER_API_BASE = "https://www.courtlistener.com/api/rest/v4";
const API_KEY = process.env.COURTLISTENER_API_KEY || "";

interface SearchArgs {
  search_keywords: string[];
  problem_summary?: string;
  case_type?: string;
  date_range?: "recent-2years" | "established-precedent" | "all-time";
  limit?: number;
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
}

interface AnalyzeCaseOutcomesArgs {
  case_type: string;
  court_level?: "trial" | "appellate" | "all";
  date_range?: "last-year" | "last-2years" | "last-5years";
}

interface JudgeAnalysisArgs {
  judge_name: string;
  case_type: string;
  court?: string;
}

interface ValidateCitationsArgs {
  citations: string[];
  context_text?: string;
}

interface ProceduralRequirementsArgs {
  case_type: string;
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
  primary: string[];
  secondary: string[];
}

interface CourtJurisdiction {
  name: string;
  limit: number | null;
  filing_fee: string;
}

class CourtListenerMCPServer {
  private server: Server;
  private axiosInstance: AxiosInstance;

  constructor() {
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
        Authorization: API_KEY ? `Token ${API_KEY}` : undefined,
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
                  'Array of legal search terms extracted by LLM from problem description (e.g., ["breach of warranty", "consumer protection", "defective product"])',
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
                description: "Type of consumer issue",
                enum: [
                  "consumer",
                  "small-claims",
                  "landlord-tenant",
                  "contract",
                  "warranty",
                  "debt-collection",
                  "auto",
                  "employment",
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
                  'Key legal concepts to match (e.g., ["breach of warranty", "consumer protection"])',
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
                description: "Type of consumer issue to analyze",
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
                  "Area of law to analyze (e.g., consumer protection, small claims)",
              },
              court: {
                type: "string",
                description: "Specific court identifier (optional)",
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
            },
            required: ["citations"],
          },
        },
        {
          name: "get_procedural_requirements",
          description:
            "Find procedural rules and filing requirements for case type in NY courts",
          inputSchema: {
            type: "object",
            properties: {
              case_type: {
                type: "string",
                description: "Type of consumer complaint",
              },
              court: {
                type: "string",
                description: "Target court for filing (NY court identifier)",
                default: "ny-civ-ct",
              },
              claim_amount: {
                type: "number",
                description:
                  "Dollar amount of dispute (influences court jurisdiction)",
              },
            },
            required: ["case_type"],
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

  private getNYCourts(): CourtInfo {
    return {
      primary: [
        "ny-civ-ct",
        "ny-city-ct-buffalo",
        "ny-city-ct-rochester",
        "ny-city-ct-syracuse",
        "ny-city-ct-albany",
        "ny-city-ct-yonkers",
        "ny-dist-ct-nassau",
        "ny-dist-ct-suffolk",
      ],
      secondary: [
        "ny-supreme-ct",
        "ny-app-div-1st",
        "ny-app-div-2nd",
        "ny-app-div-3rd",
        "ny-app-div-4th",
        "ny-ct-app",
      ],
    };
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

  private async searchCasesByProblem(args: SearchArgs) {
    const {
      search_keywords,
      problem_summary,
      case_type,
      date_range = "recent-2years",
      limit = 10,
    } = args;

    try {
      const validKeywords = this.validateSearchKeywords(search_keywords);

      const primaryTerms = validKeywords.slice(0, 5);
      const searchQuery = primaryTerms.map((term) => `"${term}"`).join(" OR ");

      const enhancedQuery = validKeywords.some((k) =>
        k.toLowerCase().includes("consumer"),
      )
        ? searchQuery
        : `(${searchQuery}) AND (consumer OR "consumer protection")`;

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

      const nyCourts = this.getNYCourts();
      const courtFilter = nyCourts.primary.join(",");

      const params = {
        q: enhancedQuery,
        type: "o",
        court: courtFilter,
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
                  query_constructed: enhancedQuery,
                  date_range_applied: date_range,
                  courts_searched: "NY primary consumer courts",
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
                  'Ensure search_keywords is an array of 1-10 legal terms. Example: ["breach of warranty", "consumer protection", "defective product"]',
                example_usage: {
                  search_keywords: [
                    "breach of warranty",
                    "consumer protection",
                  ],
                  problem_summary:
                    "Client purchased defective car, dealer refuses warranty repair",
                  case_type: "warranty",
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
    } = args;

    try {
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
      const nyCourts = this.getNYCourts();

      const params = {
        q: searchQuery,
        type: "o",
        court: [...nyCourts.primary, ...nyCourts.secondary].join(","),
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
                  courts_searched: "NY primary and secondary courts",
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
    const { case_type, court_level = "all", date_range = "last-2years" } = args;

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

    const nyCourts = this.getNYCourts();
    const courtsToSearch =
      court_level === "trial"
        ? nyCourts.primary
        : court_level === "appellate"
          ? nyCourts.secondary
          : [...nyCourts.primary, ...nyCourts.secondary];

    try {
      const params = {
        q: `"${case_type}" OR consumer`,
        type: "r",
        court: courtsToSearch.join(","),
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
                  courts_analyzed: courtsToSearch.length,
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
    const { judge_name, case_type, court } = args;

    try {
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
                  suggestion: "Check spelling or try last name only",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const judge = judges[0];
      const judgeId = judge.id;

      const opinionParams: any = {
        author: judgeId,
        q: case_type,
        type: "o",
        page_size: 20,
        fields: "id,case_name,court,date_filed,type",
      };

      if (court) {
        opinionParams.court = court;
      }

      const opinionResponse = await this.axiosInstance.get("/search/", {
        params: opinionParams,
      });
      const opinions = opinionResponse.data.results;

      const analysis = {
        judge_info: {
          name: judge.name_full,
          id: judge.id,
          positions: judge.positions?.slice(-3) || [],
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
    const { citations, context_text } = args;

    const results = {
      validation_summary: {
        total_citations: citations.length,
        valid_citations: 0,
        invalid_citations: 0,
      },
      citation_details: [] as any[],
      related_cases: [] as any[],
    };

    for (const citation of citations.slice(0, 10)) {
      try {
        const searchParams = {
          q: `"${citation}"`,
          type: "o",
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
    const { case_type, court = "ny-civ-ct", claim_amount } = args;

    const courtJurisdiction: Record<string, CourtJurisdiction> = {
      "ny-civ-ct": {
        name: "NYC Civil Court",
        limit: 25000,
        filing_fee: "$20-45",
      },
      "ny-dist-ct-nassau": {
        name: "Nassau District Court",
        limit: 15000,
        filing_fee: "$15-30",
      },
      "ny-dist-ct-suffolk": {
        name: "Suffolk District Court",
        limit: 15000,
        filing_fee: "$15-30",
      },
      "ny-supreme-ct": {
        name: "NY Supreme Court",
        limit: null,
        filing_fee: "$210+",
      },
    };

    const selectedCourt =
      courtJurisdiction[court] || courtJurisdiction["ny-civ-ct"];
    const jurisdictionCheck =
      claim_amount && selectedCourt.limit
        ? claim_amount <= selectedCourt.limit
        : true;

    try {
      const searchParams = {
        q: `"${case_type}" AND (procedure OR filing OR requirement)`,
        court: court,
        type: "o",
        page_size: 10,
        fields: "id,case_name,date_filed,snippet",
      };

      const response = await this.axiosInstance.get("/search/", {
        params: searchParams,
      });
      const proceduralCases = response.data.results.slice(0, 5);

      const requirements = {
        court_info: {
          court_name: selectedCourt.name,
          jurisdiction_limit: selectedCourt.limit,
          estimated_filing_fee: selectedCourt.filing_fee,
          jurisdiction_appropriate: jurisdictionCheck,
        },
        case_type_analysis: case_type,
        procedural_insights: proceduralCases.map((case_item: any) => ({
          case_name: case_item.case_name,
          date: case_item.date_filed,
          procedural_note: this.truncateText(case_item.snippet, 150),
        })),
        general_requirements: [
          "File complaint with proper court",
          "Pay required filing fees",
          "Serve defendants properly",
          "Include all required documentation",
          "Meet statute of limitations",
        ],
        recommended_actions: [
          jurisdictionCheck
            ? `✓ ${selectedCourt.name} has jurisdiction for this claim amount`
            : `⚠ Consider ${selectedCourt.limit ? "higher" : "lower"} court for this claim amount`,
          "Review recent similar cases for procedural precedents",
          "Ensure all documentary evidence is properly prepared",
          "Consider mediation or settlement before filing",
        ],
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
                court: selectedCourt.name,
                error: `Could not retrieve specific procedural requirements: ${error instanceof Error ? error.message : String(error)}`,
                general_guidance: {
                  filing_fee: selectedCourt.filing_fee,
                  jurisdiction_limit: selectedCourt.limit,
                  basic_steps: [
                    "Prepare complaint",
                    "Pay fees",
                    "Serve defendants",
                    "Await response",
                  ],
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
      const nyCourts = this.getNYCourts();
      const params = {
        q: searchQuery,
        type: trend_type === "new-precedents" ? "o" : "r",
        court: [...nyCourts.primary, ...nyCourts.secondary].join(","),
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
                error: `Trend analysis failed: ${error instanceof Error ? error.message : String(error)}`,
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

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("CourtListener MCP Server running...");
  }
}

const server = new CourtListenerMCPServer();
server.run().catch(console.error);
