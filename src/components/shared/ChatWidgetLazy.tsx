'use client'

import dynamic from 'next/dynamic'

// The floating chat widget polls every 15s and ships its own icon bundle —
// none of that is needed for the first paint. Loading it with ssr:false keeps
// it out of the server-rendered HTML and its JS out of the initial bundle; it
// streams in after hydration.
const ChatWidget = dynamic(
  () => import('@/components/shared/ChatWidget').then((m) => m.ChatWidget),
  { ssr: false }
)

export function ChatWidgetLazy() {
  return <ChatWidget />
}
