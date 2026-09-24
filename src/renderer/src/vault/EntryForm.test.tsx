// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = {
  vault: {
    createEntry: vi.fn(),
    generatePassword: vi.fn()
  }
}
vi.stubGlobal('api', api)

const { EntryForm } = await import('./EntryForm')

function renderNew(type: string, prefill?: Record<string, string>) {
  return render(<EntryForm uuid="new" create={{ type, prefill }} />)
}

describe('EntryForm with entry types', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.vault.createEntry.mockResolvedValue({ result: 'new-uuid' })
  })

  it('starts from a search suggestion and names the recognised format', async () => {
    const user = userEvent.setup()
    renderNew('taxId', { 'Tax ID number': '86 095 742 719', Country: 'de', 'ID kind': 'Personal' })

    expect(screen.getByLabelText(/Tax ID number/)).toHaveValue('86 095 742 719')
    expect(screen.getByText('German tax ID')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(api.vault.createEntry).toHaveBeenCalled())
    expect(api.vault.createEntry.mock.calls[0][1].customFields).toEqual(
      expect.arrayContaining([
        { key: 'Tax ID number', value: '86 095 742 719', protected: false },
        { key: 'Country', value: 'DE', protected: false },
        { key: 'ID kind', value: 'Personal', protected: false }
      ])
    )
  })

  it('puts a prefilled website into the standard URL field', () => {
    renderNew('login', { URL: 'https://github.com' })
    expect(screen.getByDisplayValue('https://github.com')).toBeTruthy()
  })

  it('creates a passport with typed fields and a suggested title', async () => {
    const user = userEvent.setup()
    renderNew('passport')

    expect(screen.getByText('New passport')).toBeTruthy()
    await user.type(screen.getByLabelText(/Given names/), 'Jane')
    await user.type(screen.getByLabelText(/Surname/), 'Doe')
    await user.type(screen.getByLabelText(/Passport number/), 'C01X00T47')
    await user.type(screen.getByLabelText(/Nationality/), 'de')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(api.vault.createEntry).toHaveBeenCalled())
    const [group, input] = api.vault.createEntry.mock.calls[0]
    expect(group).toBeUndefined()
    expect(input).toMatchObject({ type: 'passport', title: 'Passport – Jane Doe' })
    expect(input.customFields).toEqual([
      { key: 'Given names', value: 'Jane', protected: false },
      { key: 'Surname', value: 'Doe', protected: false },
      { key: 'Passport number', value: 'C01X00T47', protected: false },
      { key: 'Nationality', value: 'DE', protected: false }
    ])
  })

  it('rejects an invalid IBAN and marks secrets protected', async () => {
    const user = userEvent.setup()
    renderNew('bankAccount')

    await user.type(screen.getByLabelText(/^IBAN/), 'DE89 3704 0044 0532 0130 01')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Not a valid IBAN')).toBeTruthy()
    expect(api.vault.createEntry).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText(/^IBAN/))
    await user.type(screen.getByLabelText(/^IBAN/), 'de89370400440532013000')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(api.vault.createEntry).toHaveBeenCalled())
    const input = api.vault.createEntry.mock.calls[0][1]
    expect(input.customFields).toContainEqual({
      key: 'IBAN',
      value: 'DE89 3704 0044 0532 0130 00',
      protected: false
    })
  })

  it('requires the type-defining field', async () => {
    const user = userEvent.setup()
    renderNew('creditCard')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Card number is required')).toBeTruthy()

    await user.type(screen.getByLabelText(/Card number/, { selector: 'input' }), '4111111111111111')
    await user.type(screen.getByLabelText(/Security code/, { selector: 'input' }), '737')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(api.vault.createEntry).toHaveBeenCalled())
    const input = api.vault.createEntry.mock.calls[0][1]
    expect(input.customFields).toContainEqual({
      key: 'Card number',
      value: '4111 1111 1111 1111',
      protected: true
    })
    expect(input.customFields).toContainEqual({ key: 'CVV', value: '737', protected: true })
  })
})
