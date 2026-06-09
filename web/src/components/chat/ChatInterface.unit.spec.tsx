import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ai-sdk/react', () => ({
  useChat: vi.fn(() => ({
    messages: [],
    status: 'ready',
    error: null,
    sendMessage: vi.fn(),
  })),
}))

vi.mock('ai', () => ({
  DefaultChatTransport: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: {
    getConversation: vi.fn(),
    getModels: vi.fn(),
    chatUrl: vi.fn(() => 'http://localhost:3001/api/chat'),
  },
}))

import { useChat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { api } from '../../lib/api'
import ChatInterface, { ContextUsage, dbMessageToUIMessage, formatNumber } from './ChatInterface'

const makeDbMessage = (
  overrides: Partial<{
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    parts: Array<{ type: string; text?: string }>
    metadata: Record<string, unknown>
    conversationId: string
    createdAt: string
  }> = {},
) => ({
  id: 'msg-1',
  conversationId: 'conv-1',
  role: 'user' as const,
  content: 'Hello',
  parts: [],
  metadata: {},
  createdAt: new Date().toISOString(),
  ...overrides,
})

const baseConversation = {
  id: 'conv-1',
  seq: 1,
  level: 'B1',
  profile: 'professor' as const,
  model: 'model-a',
  title: 'Test chat',
  metadata: {},
  webSearchEnabled: false,
  reviewedAt: null,
  createdAt: '',
  updatedAt: '',
  messages: [],
}

type TestConversation = typeof baseConversation

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.getConversation).mockResolvedValue(baseConversation)
  vi.mocked(api.getModels).mockResolvedValue({
    models: [{ id: 'model-a', name: 'Model A', contextWindow: 8192 }],
    defaultModel: 'model-a',
    fallbackModel: 'model-b',
    productionRecommendedModel: 'model-a',
    contextWindow: 8192,
  })
  vi.mocked(useChat).mockReturnValue({
    messages: [],
    status: 'ready',
    error: null,
    sendMessage: vi.fn(),
  } as unknown as ReturnType<typeof useChat>)
})

// ─── dbMessageToUIMessage ────────────────────────────────────────────────────

describe('dbMessageToUIMessage', () => {
  it('uses parts array when it is non-empty', () => {
    const msg = makeDbMessage({ parts: [{ type: 'text', text: 'hi' }] })
    const result = dbMessageToUIMessage(msg)

    expect(result.id).toBe('msg-1')
    expect(result.role).toBe('user')
    expect(result.parts).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('falls back to content wrapped in a text part when parts is empty', () => {
    const msg = makeDbMessage({ parts: [], content: 'fallback content' })
    const result = dbMessageToUIMessage(msg)

    expect(result.parts).toEqual([{ type: 'text', text: 'fallback content' }])
  })

  it('maps role correctly for assistant messages', () => {
    const msg = makeDbMessage({ role: 'assistant' })
    const result = dbMessageToUIMessage(msg)

    expect(result.role).toBe('assistant')
  })
})

// ─── formatNumber ────────────────────────────────────────────────────────────

describe('formatNumber', () => {
  it('formats numbers using pt-BR locale', () => {
    expect(formatNumber(1000)).toBe((1000).toLocaleString('pt-BR'))
    expect(formatNumber(1234567)).toBe((1234567).toLocaleString('pt-BR'))
  })

  it('returns string for zero', () => {
    expect(formatNumber(0)).toBe('0')
  })
})

// ─── ContextUsage ────────────────────────────────────────────────────────────

describe('ContextUsage', () => {
  it('displays correct percentage', () => {
    render(
      <ContextUsage
        tokensUsed={500}
        contextWindow={1000}
      />,
    )

    expect(screen.getByText(/50\.0%/)).toBeInTheDocument()
  })

  it('caps percentage at 100% when tokensUsed exceeds contextWindow', () => {
    render(
      <ContextUsage
        tokensUsed={1500}
        contextWindow={1000}
      />,
    )

    expect(screen.getByText(/100\.0%/)).toBeInTheDocument()
  })

  it('uses green color below 70%', () => {
    const { container } = render(
      <ContextUsage
        tokensUsed={600}
        contextWindow={1000}
      />,
    )
    const fill = container.querySelector('.context-usage-bar-fill') as HTMLElement

    expect(fill.style.backgroundColor).toBe('rgb(34, 197, 94)')
  })

  it('uses amber color at and above 70%', () => {
    const { container } = render(
      <ContextUsage
        tokensUsed={700}
        contextWindow={1000}
      />,
    )
    const fill = container.querySelector('.context-usage-bar-fill') as HTMLElement

    expect(fill.style.backgroundColor).toBe('rgb(245, 158, 11)')
  })

  it('uses red color at and above 90%', () => {
    const { container } = render(
      <ContextUsage
        tokensUsed={900}
        contextWindow={1000}
      />,
    )
    const fill = container.querySelector('.context-usage-bar-fill') as HTMLElement

    expect(fill.style.backgroundColor).toBe('rgb(239, 68, 68)')
  })

  it('sets bar width to percentage', () => {
    const { container } = render(
      <ContextUsage
        tokensUsed={250}
        contextWindow={1000}
      />,
    )
    const fill = container.querySelector('.context-usage-bar-fill') as HTMLElement

    expect(fill.style.width).toBe('25%')
  })
})

// ─── ChatInterface component ─────────────────────────────────────────────────

describe('ChatInterface', () => {
  it('shows error message when conversation fails to load', async () => {
    vi.mocked(api.getConversation).mockRejectedValue(new Error('Not found'))

    render(<ChatInterface conversationId='conv-1' />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load conversation history.')).toBeInTheDocument()
    })
  })

  it('renders without errors when conversation loads successfully', async () => {
    render(<ChatInterface conversationId='conv-1' />)

    await waitFor(() => {
      expect(api.getConversation).toHaveBeenCalledWith('conv-1')
    })

    expect(screen.queryByText('Failed to load conversation history.')).not.toBeInTheDocument()
  })

  it('passes initialMessages to useChat excluding system messages', async () => {
    const systemMsg = makeDbMessage({ id: 'sys', role: 'system', content: 'system prompt' })
    const userMsg = makeDbMessage({ id: 'u1', role: 'user', content: 'hello' })
    vi.mocked(api.getConversation).mockResolvedValue({
      ...baseConversation,
      messages: [systemMsg, userMsg],
    })

    render(<ChatInterface conversationId='conv-1' />)

    await waitFor(() => {
      expect(vi.mocked(useChat)).toHaveBeenCalled()
      const chatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as unknown as { messages?: UIMessage[] }
      expect(chatOptions?.messages).toHaveLength(1)
      expect(chatOptions?.messages?.[0].id).toBe('u1')
    })
  })

  it('waits for conversation history before initializing useChat', async () => {
    let resolveConversation: ((value: TestConversation) => void) | undefined
    vi.mocked(api.getConversation).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveConversation = resolve
        }),
    )

    render(<ChatInterface conversationId='conv-1' />)

    expect(vi.mocked(useChat)).not.toHaveBeenCalled()

    resolveConversation?.({
      ...baseConversation,
      messages: [makeDbMessage({ id: 'u1', role: 'user', content: 'hello' })],
    })

    await waitFor(() => {
      expect(vi.mocked(useChat)).toHaveBeenCalled()
      const chatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as unknown as { messages?: UIMessage[] }
      expect(chatOptions?.messages?.[0]?.id).toBe('u1')
    })
  })

  it('does not seed a switched conversation with the previous conversation messages', async () => {
    vi.mocked(api.getConversation).mockImplementation(async id => ({
      ...baseConversation,
      id,
      messages: [makeDbMessage({ id: id === 'conv-1' ? 'u1' : 'u2', conversationId: id, content: id })],
    }))

    const { rerender } = render(<ChatInterface conversationId='conv-1' />)

    await waitFor(() => {
      const chatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as unknown as { id?: string; messages?: UIMessage[] }
      expect(chatOptions?.id).toBe('conv-1')
      expect(chatOptions?.messages?.[0]?.id).toBe('u1')
    })

    vi.mocked(useChat).mockClear()
    rerender(<ChatInterface conversationId='conv-2' />)

    await waitFor(() => {
      const conv2Calls = vi.mocked(useChat).mock.calls.filter(([options]) => {
        return (options as unknown as { id?: string }).id === 'conv-2'
      })
      expect(conv2Calls.length).toBeGreaterThan(0)
      expect((conv2Calls.at(-1)?.[0] as unknown as { messages?: UIMessage[] }).messages?.[0]?.id).toBe('u2')
    })

    const conv2Calls = vi.mocked(useChat).mock.calls.filter(([options]) => {
      return (options as unknown as { id?: string }).id === 'conv-2'
    })
    expect(conv2Calls).not.toContainEqual(
      expect.arrayContaining([expect.objectContaining({ messages: [expect.objectContaining({ id: 'u1' })] })]),
    )
  })

  it('ignores late conversation responses after switching conversationId', async () => {
    const resolvers: Record<string, (value: TestConversation) => void> = {}
    vi.mocked(api.getConversation).mockImplementation(
      id =>
        new Promise(resolve => {
          resolvers[id] = resolve
        }),
    )

    const { rerender } = render(<ChatInterface conversationId='conv-1' />)
    rerender(<ChatInterface conversationId='conv-2' />)

    await act(async () => {
      resolvers['conv-1']?.({
        ...baseConversation,
        id: 'conv-1',
        messages: [makeDbMessage({ id: 'u1', conversationId: 'conv-1', content: 'old' })],
      })
    })

    expect(vi.mocked(useChat)).not.toHaveBeenCalled()

    await act(async () => {
      resolvers['conv-2']?.({
        ...baseConversation,
        id: 'conv-2',
        messages: [makeDbMessage({ id: 'u2', conversationId: 'conv-2', content: 'new' })],
      })
    })

    await waitFor(() => {
      const chatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as unknown as { id?: string; messages?: UIMessage[] }
      expect(chatOptions?.id).toBe('conv-2')
      expect(chatOptions?.messages?.[0]?.id).toBe('u2')
    })
  })

  it('shows stream error when useChat returns an error', async () => {
    vi.mocked(useChat).mockReturnValue({
      messages: [],
      status: 'error',
      error: new Error('Stream failed'),
      sendMessage: vi.fn(),
    } as unknown as ReturnType<typeof useChat>)

    render(<ChatInterface conversationId='conv-1' />)

    await waitFor(() => {
      expect(screen.getByText(/Stream failed/)).toBeInTheDocument()
    })
  })
})
