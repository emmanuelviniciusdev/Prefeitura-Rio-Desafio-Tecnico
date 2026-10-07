import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { COPY } from '../copy'
import { BrandLogo } from './BrandLogo'

describe('BrandLogo', () => {
  it('renders the PNG logo with the app name as alternative text', () => {
    render(<BrandLogo />)

    expect(screen.getByRole('img', { name: COPY.appName })).toHaveAttribute(
      'src',
      '/taxi-rio.png',
    )
  })
})
