// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeidentifyView } from '../../../main/deidentify/protocol'

const view: DeidentifyView = {
  sessionId: 1,
  mode: 'deidentify',
  targetName: 'TextEdit',
  empty: false,
  needsUnlock: false,
  restorable: 0,
  model: { state: 'ready' },
  segments: [
    { type: 'text', text: 'Hi ' },
    {
      type: 'span',
      id: '3-11-PERSON',
      kind: 'PERSON',
      label: 'person',
      text: 'Jane Doe',
      locked: false,
      enabled: true,
      source: 'model'
    },
    { type: 'text', text: ', mail ' },
    {
      type: 'span',
      id: '18-28-EMAIL',
      kind: 'EMAIL',
      label: 'email',
      text: 'jane@x.com',
      locked: false,
      enabled: true,
      source: 'rule'
    },
    { type: 'text', text: ', pw ' },
    {
      type: 'span',
      id: '33-41-CREDENTIAL',
      kind: 'CREDENTIAL',
      label: 'Gmail / Password',
      locked: true,
      enabled: true,
      source: 'vault'
    }
  ]
}

const api = {
  deidentify: {
    current: vi.fn(async () => view),
    onView: vi.fn(() => () => {}),
    apply: vi.fn(async () => ({ pasted: true, replaced: 2 })),
    dismiss: vi.fn(),
    setMode: vi.fn(),
    submitText: vi.fn(),
    keepOpen: vi.fn()
  }
}
vi.stubGlobal('api', api)

const { Deidentify } = await import('./Deidentify')
const { TooltipProvider } = await import('@/components/ui/tooltip')

const renderPopup = () =>
  render(
    <TooltipProvider>
      <Deidentify />
    </TooltipProvider>
  )

describe('Deidentify popup', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows detected spans, and a credential only as a locked chip', async () => {
    renderPopup()
    expect(await screen.findByText('Jane Doe')).toBeTruthy()
    expect(screen.getByText('jane@x.com')).toBeTruthy()
    expect(screen.getByText('CREDENTIAL')).toBeTruthy()
    expect(screen.getByText('3 to replace')).toBeTruthy()
    // The credential chip is not a button: it cannot be switched off.
    expect(screen.queryByRole('button', { name: /CREDENTIAL/ })).toBeNull()
  })

  it('sends only the spans left on, and pastes on Enter', async () => {
    const user = userEvent.setup()
    renderPopup()
    await user.click(await screen.findByRole('button', { name: /Jane Doe/ }))
    expect(screen.getByText('2 to replace')).toBeTruthy()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.deidentify.apply).toHaveBeenCalled())
    expect(api.deidentify.apply).toHaveBeenCalledWith(
      { enabled: ['18-28-EMAIL'], manual: [] },
      'paste'
    )
  })

  it('copies instead with ⌘C and closes with Escape', async () => {
    const user = userEvent.setup()
    renderPopup()
    await screen.findByText('Jane Doe')
    await user.keyboard('{Meta>}c{/Meta}')
    await waitFor(() =>
      expect(api.deidentify.apply).toHaveBeenCalledWith(
        { enabled: ['3-11-PERSON', '18-28-EMAIL'], manual: [] },
        'copy'
      )
    )
    await user.keyboard('{Escape}')
    expect(api.deidentify.dismiss).toHaveBeenCalled()
  })

  it('asks for text when no selection could be read', async () => {
    api.deidentify.current.mockResolvedValueOnce({
      ...view,
      sessionId: 2,
      empty: true,
      segments: []
    })
    const user = userEvent.setup()
    renderPopup()
    await user.type(await screen.findByRole('textbox'), 'Call Jane')
    await user.click(screen.getByRole('button', { name: /Check text/ }))
    expect(api.deidentify.submitText).toHaveBeenCalledWith('Call Jane')
  })
})
