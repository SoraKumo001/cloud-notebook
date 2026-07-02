import { defineRelations } from 'drizzle-orm'
import * as s from './schema/index'

export const relations = defineRelations(s, (r) => ({
  users: {
    sessions: r.many.sessions({ from: r.users.id, to: r.sessions.userId }),
    notebooks: r.many.notebooks({ from: r.users.id, to: r.notebooks.userId }),
    invitationsCreated: r.many.invitations({
      from: r.users.id,
      to: r.invitations.invitedBy,
    }),
    invitationsConsumed: r.many.invitations({
      from: r.users.id,
      to: r.invitations.usedBy,
    }),
  },
  notebooks: {
    sources: r.many.sources({ from: r.notebooks.id, to: r.sources.notebookId }),
    notes: r.many.notes({ from: r.notebooks.id, to: r.notes.notebookId }),
    chatSessions: r.many.chatSessions({ from: r.notebooks.id, to: r.chatSessions.notebookId }),
    // M15.2: Direct relation so RQB can fetch images at notebook level
    // (the chain notebooks → sources → sourceImages also works but requires a
    // nested with, which adds a JOIN level).
    sourceImages: r.many.sourceImages({
      from: r.notebooks.id,
      to: r.sourceImages.notebookId,
    }),
  },
  sources: {
    sourceChunks: r.many.sourceChunks({ from: r.sources.id, to: r.sourceChunks.sourceId }),
    sourceImages: r.many.sourceImages({ from: r.sources.id, to: r.sourceImages.sourceId }),
  },
  chatSessions: {
    chatMessages: r.many.chatMessages({
      from: r.chatSessions.id,
      to: r.chatMessages.sessionId,
    }),
  },
}))
