import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import config from '../tailwind.config'
import ToastContainer from '@/components/ToastContainer'
import { useToast, type Toast } from '@/lib/toast'

let stylesheet: HTMLStyleElement
beforeAll(async () => {
  // Exercise the real stylesheet: DOM-only assertions cannot detect unreadable text.
  const css = await postcss([tailwindcss(config)]).process(
    readFileSync('src/index.css', 'utf8'), { from: undefined })
  css.root.walkAtRules('import', rule => { rule.remove() })
  stylesheet = document.createElement('style')
  stylesheet.textContent = css.root.toString()
  document.head.append(stylesheet)
})
afterEach(() => {
  cleanup()
  for (const toast of useToast.getState().toasts) useToast.getState().remove(toast.id)
})

const channels = (color: string) => color.match(/[\d.]+/g)!.map(Number)
const luminance = (rgb: number[]) => rgb.slice(0, 3).map(value => {
  const channel = value / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
const contrast = (foreground: string, background: string, surface: number[]) => {
  const bg = channels(background)
  const alpha = bg[3] ?? 1
  const effectiveBackground = bg.slice(0, 3).map((value, index) => value * alpha + surface[index] * (1 - alpha))
  const values = [luminance(channels(foreground)), luminance(effectiveBackground)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

for (const theme of ['light', 'dark']) {
  it.each<Toast['type']>(['success', 'error', 'warning', 'info'])(`renders readable %s text in ${theme} mode`, type => {
    const message = type === 'success' ? 'Quote deleted' : `${type} notification message`
    useToast.getState().add(message, type, 0)
    render(<div className={theme === 'dark' ? 'app-theme-dark' : ''}><ToastContainer /></div>)
    const notification = screen.getByRole(type === 'error' || type === 'warning' ? 'alert' : 'status')
    expect(screen.getByText(message).textContent).toBe(message)
    const style = getComputedStyle(notification)
    expect(contrast(style.color, style.backgroundColor, theme === 'dark' ? [11, 18, 34] : [255, 255, 255])).toBeGreaterThanOrEqual(4.5)
    expect(screen.getByRole('button', { name: `Dismiss ${type} notification` })).toBeTruthy()
  })
}
