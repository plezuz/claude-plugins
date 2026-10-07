import type { ClientModule } from 'claude-code'

// The ≡ menu button, drawn as gray text: the desktop's native Button ignores dimColor.
// A click posts 'toggle' to the hooks module, which opens or closes the view menu.
const MenuButton: ClientModule<null> = (_props, surface) => {
  const { Text } = surface.elements
  surface.onPointer(e => {
    if (e.type === 'up') surface.post('toggle')
  })
  return <Text dimColor>{'≡'}</Text>
}

export default MenuButton
