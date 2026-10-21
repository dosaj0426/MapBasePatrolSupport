/** The first server response restores history silently, including unread alerts. */
export class AlertInbox {
  cursor = 0;
  initialized = false;
  receive<T extends {id: number; read: boolean}>(items: T[], deliver: (item: T, announce: boolean) => void) {
    for(const item of [...items].sort((a,b)=>a.id-b.id)) {
      if(item.id<=this.cursor)continue;
      deliver(item,this.initialized && !item.read);
      this.cursor=item.id;
    }
    this.initialized=true;
  }
}
