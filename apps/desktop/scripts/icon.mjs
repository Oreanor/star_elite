import sharp from 'sharp'

// Иконка обязана быть квадратной, а силуэт корабля — вытянутый: вписываем его в прозрачный квадрат.
await sharp('../web/public/ship.webp')
  .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile('src-tauri/icons/source.png')
