import { COPY } from '../copy'

interface BrandLogoProps {
  size?: 'sm' | 'lg'
}

const sizeClass = {
  sm: 'h-12 w-auto',
  lg: 'h-28 w-auto',
} as const

export function BrandLogo({ size = 'sm' }: BrandLogoProps) {
  return (
    <img
      src="/taxi-rio.png"
      alt={COPY.appName}
      className={`${sizeClass[size]} object-contain`}
    />
  )
}
