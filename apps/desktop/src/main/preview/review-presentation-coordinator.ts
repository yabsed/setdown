/** A display transaction owns one target until it is either committed or cancelled.
 * No native visibility is changed while another renderer prepares the target.
 */
export type PresentationTarget = {
  owner: number; view: string; id: number;
  revision: number; geometry: string; page: string;
};
type Ticket = PresentationTarget & { generation: number; expires: ReturnType<typeof setTimeout> };
export class ReviewPresentationCoordinator {
  private readonly pending = new Map<number, Ticket>();
  private generation = 0;
  constructor(private readonly failed: (target: PresentationTarget, reason: string) => void,
    private readonly timeoutMs = 5000) {}

  begin(target: PresentationTarget): number {
    this.cancel(target.owner);
    const generation = ++this.generation;
    const expires = setTimeout(() => {
      if (this.pending.get(target.owner)?.generation !== generation) return;
      this.pending.delete(target.owner);
      this.failed(target, 'The prepared review did not acknowledge presentation.');
    }, this.timeoutMs);
    this.pending.set(target.owner, { ...target, generation, expires });
    return generation;
  }
  finish(owner: number, view: string, generation: number,
    revision: number, geometry: string, page: string): PresentationTarget | null {
    const ticket = this.pending.get(owner);
    if (!ticket || ticket.view !== view || ticket.generation !== generation) return null;
    if (ticket.revision !== revision || ticket.geometry !== geometry || ticket.page !== page) {
      this.cancel(owner);
      this.failed(ticket, 'The review changed during presentation.');
      return null;
    }
    this.cancel(owner);
    return ticket;
  }
  cancel(owner: number): void {
    const ticket = this.pending.get(owner);
    if (ticket) clearTimeout(ticket.expires);
    this.pending.delete(owner);
  }
  cancelView(view: string): void {
    for (const [owner, ticket] of this.pending) if (ticket.view === view) this.cancel(owner);
  }
}
