export interface InfrastructureAssessment { summary: string; available: boolean; }
export interface InfrastructureAgent { analyze(): Promise<InfrastructureAssessment>; diagnose(input: string): Promise<InfrastructureAssessment>; repair(input: string): Promise<InfrastructureAssessment>; verify(): Promise<InfrastructureAssessment>; }
export class NullInfrastructureAgent implements InfrastructureAgent {
  private unavailable(): InfrastructureAssessment { return { summary: "Hermes is not connected in Visual Office Phase 1.", available: false }; }
  async analyze() { return this.unavailable(); } async diagnose(_input: string) { return this.unavailable(); } async repair(_input: string) { return this.unavailable(); } async verify() { return this.unavailable(); }
}
