/**
 * The choices on the contact form (/contact). Client-safe: the form, /admin
 * and the server all read these.
 */

export const TOPICS = [['workshop', 'A workshop'], ['party', 'A party'], ['cafe', 'Craft Café'], ['other', 'Something else']] as const
export type Topic = (typeof TOPICS)[number][0]

export const STATUSES = ['new', 'replied'] as const
export type MessageStatus = (typeof STATUSES)[number]
export const STATUS_LABEL: Record<MessageStatus, string> = { new: 'New', replied: 'Replied' }

export interface ContactMessage {
  id: string
  at: string
  status: MessageStatus
  statusAt?: string
  name: string
  email: string
  phone: string
  topic: Topic | ''
  message: string
  photos: number
}

export const topicLabel = (t: string) => TOPICS.find(([k]) => k === t)?.[1] ?? ''
