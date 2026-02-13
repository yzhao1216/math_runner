import './style.css'
import * as THREE from 'three'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import fontUrl from 'three/examples/fonts/helvetiker_regular.typeface.json?url'

// --- Constants ---
const RUN_SPEED = 15
const ROAD_WIDTH = 18
const ROAD_X_MIN = -9
const ROAD_X_MAX = 9
const CAMERA_HEIGHT_DEFAULT = 8
const CAMERA_Z_OFFSET_DEFAULT = 10
const CAMERA_LERP = 0.08
const CAMERA_HEIGHT_RATIO = (CAMERA_HEIGHT_DEFAULT - 0.5) / CAMERA_Z_OFFSET_DEFAULT // keep same view angle when pulling back
const FLOOR_WIDTH = 30
const CHUNK_LENGTH = 80
const NUM_ROAD_CHUNKS = 4
const ROW_SPACING = 26
const SPAWN_AHEAD = 80
const COLLIDE_RADIUS = 1.0
const ROW_LANES = [-8, 0, 8] // Left, Center, Right
const TUTORIAL_ROWS = 5
const POSSIBLE_VALUES = [1, 2, 3, 5, 7, 10, 15, 20, 25, 30, 40, 50]
const NEGATIVE_VALUES = [-10, -20, -50]
const NEGATIVE_CHANCE = 0.3
const DIVISION_GATE_CHANCE = 0.05
const COLOR_POSITIVE = 0x00aa00
const COLOR_NEGATIVE = 0xff0000
const VICTORY_TARGET = 300
const VICTORY_WALL_AHEAD = 50

// --- Scene ---
const scene = new THREE.Scene()
const backgroundColor = 0x87ceeb
scene.background = new THREE.Color(backgroundColor)
const FOG_NEAR = 20
const FOG_FAR = 90
scene.fog = new THREE.Fog(backgroundColor, FOG_NEAR, FOG_FAR)

// --- Grid texture for moving floor effect ---
function createGridTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#f0f0f0'
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = '#d0d0d0'
  ctx.lineWidth = 1
  const gridSize = 8
  for (let i = 0; i <= size; i += gridSize) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i, size)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i)
    ctx.lineTo(size, i)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(FLOOR_WIDTH / 1.5, CHUNK_LENGTH / 2)
  return texture
}

const roadGridTexture = createGridTexture()
const roadChunkGeometry = new THREE.PlaneGeometry(FLOOR_WIDTH, CHUNK_LENGTH)
const roadChunkMaterial = new THREE.MeshStandardMaterial({
  map: roadGridTexture,
  color: 0xf8f8f8,
})
const roadChunks = []

function createRoadChunk(backZ, frontZ) {
  const mesh = new THREE.Mesh(roadChunkGeometry, roadChunkMaterial)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(0, 0, (backZ + frontZ) / 2)
  mesh.receiveShadow = true
  return { mesh, backZ, frontZ }
}

function initRoadManager() {
  for (let i = 0; i < NUM_ROAD_CHUNKS; i++) {
    const backZ = -i * CHUNK_LENGTH
    const frontZ = -(i + 1) * CHUNK_LENGTH
    const chunk = createRoadChunk(backZ, frontZ)
    scene.add(chunk.mesh)
    roadChunks.push(chunk)
  }
}

const RECYCLE_MARGIN_CHUNKS = 2 // only recycle when chunk is at least this many chunk lengths behind the camera
function updateRoadManager(playerZ, cameraZ) {
  const recycleThreshold = cameraZ + RECYCLE_MARGIN_CHUNKS * CHUNK_LENGTH
  const safeToRecycle = roadChunks.filter((c) => c.frontZ >= recycleThreshold)
  const toRecycle = safeToRecycle.length
    ? safeToRecycle.reduce((a, b) => (a.frontZ > b.frontZ ? a : b))
    : null
  if (!toRecycle) return
  const furthestFrontZ = Math.min(...roadChunks.map((c) => c.frontZ))
  const newBackZ = furthestFrontZ
  const newFrontZ = furthestFrontZ - CHUNK_LENGTH
  toRecycle.backZ = newBackZ
  toRecycle.frontZ = newFrontZ
  toRecycle.mesh.position.z = (newBackZ + newFrontZ) / 2
  if (!victory) spawnObstaclesForChunk(newBackZ, newFrontZ)
}

initRoadManager()

// --- Light ---
scene.add(new THREE.AmbientLight(0xffffff, 0.8))
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6)
dirLight.position.set(5, 15, 5)
dirLight.castShadow = true
dirLight.shadow.mapSize.width = 1024
dirLight.shadow.mapSize.height = 1024
dirLight.shadow.camera.near = 0.5
dirLight.shadow.camera.far = 200
dirLight.shadow.camera.left = -50
dirLight.shadow.camera.right = 50
dirLight.shadow.camera.top = 50
dirLight.shadow.camera.bottom = -50
dirLight.shadow.bias = -0.0001
scene.add(dirLight)

// --- Player (dynamic 3D number) ---
const player = new THREE.Group()
player.position.set(0, 0.5, 0)
player.score = 1
player.userData.textMesh = null
scene.add(player)

function getTextScaleForDigits(str) {
  const digits = String(str).replace(/[^0-9]/g, '').length
  if (digits > 3) return 0.75
  if (digits > 2) return 0.9
  return 1.1
}

function getObstacleTextScale(textString) {
  const len = String(textString).length
  if (len >= 4) return 0.9
  if (len >= 3) return 1.0
  return 1.15
}

function updatePlayerMesh(score) {
  if (!loadedFont) return
  const oldMesh = player.userData.textMesh
  if (oldMesh) {
    player.remove(oldMesh)
    oldMesh.geometry?.dispose()
    oldMesh.material?.dispose()
  }
  const geometry = new TextGeometry(String(score), {
    font: loadedFont,
    size: 1.8,
    depth: 0.5,
    curveSegments: 12,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.06,
    bevelSegments: 4,
  })
  geometry.center()
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x000000 }))
  mesh.position.y = -box.min.y
  mesh.scale.setScalar(getTextScaleForDigits(score))
  mesh.castShadow = true
  mesh.receiveShadow = true
  player.add(mesh)
  player.userData.textMesh = mesh
}

let loadedFont = null

const fontLoader = new FontLoader()
fontLoader.loadAsync(fontUrl).then((font) => {
  loadedFont = font
  updatePlayerMesh(player.score)
})

// --- Level generator: spawn rows of 3D number obstacles (Left, Center, Right) ---
const obstacles = []
let lastSpawnZ = 0

function createNumberObstacle(x, z, value, type = 'number') {
  if (!loadedFont) return null
  let text, color
  if (type === 'division') {
    text = '/ 2'
    color = 0xff4444
  } else if (value >= 0) {
    text = String(value)
    color = COLOR_POSITIVE
  } else {
    text = String(value)
    color = COLOR_NEGATIVE
  }
  const geometry = new TextGeometry(text, {
    font: loadedFont,
    size: type === 'division' ? 1.4 : 1.2,
    depth: 0.4,
    curveSegments: 10,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.05,
    bevelSegments: 3,
  })
  geometry.center()
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  const material = new THREE.MeshStandardMaterial({
    color,
    transparent: type === 'division',
    opacity: type === 'division' ? 0.85 : 1,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(x, -box.min.y, z)
  const scale = getObstacleTextScale(text)
  mesh.scale.set(scale, scale, scale)
  mesh.castShadow = true
  scene.add(mesh)
  return { mesh, value, x, z, type: type || 'number' }
}

function getMaxPossibleScore(rowIndex) {
  if (rowIndex <= TUTORIAL_ROWS) return 1 + rowIndex
  return 6 + Math.floor((rowIndex - TUTORIAL_ROWS) * 2)
}

function getObstacleValuesForRow(rowZ) {
  const rowIndex = Math.floor(-rowZ / ROW_SPACING)
  if (rowIndex <= TUTORIAL_ROWS) {
    return [{ value: 1, isNegative: false }, { value: 1, isNegative: false }, { value: 1, isNegative: false }]
  }
  const maxPossible = getMaxPossibleScore(rowIndex)
  const safeValues = POSSIBLE_VALUES.filter((v) => v <= maxPossible)
  const safePool = safeValues.length > 0 ? safeValues : [Math.max(1, maxPossible)]
  const isNegative = [Math.random() < NEGATIVE_CHANCE, Math.random() < NEGATIVE_CHANCE, Math.random() < NEGATIVE_CHANCE]
  if (isNegative.every(Boolean)) {
    isNegative[Math.floor(Math.random() * 3)] = false
  }
  const result = []
  for (let i = 0; i < 3; i++) {
    if (isNegative[i]) {
      result.push({ value: NEGATIVE_VALUES[Math.floor(Math.random() * NEGATIVE_VALUES.length)], isNegative: true })
    } else {
      const val = i === 0
        ? safePool[Math.floor(Math.random() * safePool.length)]
        : POSSIBLE_VALUES[Math.floor(Math.random() * POSSIBLE_VALUES.length)]
      result.push({ value: val, isNegative: false })
    }
  }
  return result
}

function spawnRowAtZ(rowZ) {
  if (!loadedFont) return
  const rowIndex = Math.floor(-rowZ / ROW_SPACING)
  if (rowIndex > TUTORIAL_ROWS && Math.random() < DIVISION_GATE_CHANCE) {
    const ob = createNumberObstacle(0, rowZ, 2, 'division')
    if (ob) obstacles.push(ob)
    return
  }
  const items = getObstacleValuesForRow(rowZ)
  const lanesToUse = rowIndex <= TUTORIAL_ROWS ? [0, 1, 2] : [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, 2)
  lanesToUse.forEach((laneIndex) => {
    const x = ROW_LANES[laneIndex]
    const ob = createNumberObstacle(x, rowZ, items[laneIndex].value)
    if (ob) obstacles.push(ob)
  })
}

function levelGenerator(playerZ) {
  while (playerZ - lastSpawnZ < SPAWN_AHEAD) {
    lastSpawnZ -= ROW_SPACING
    spawnRowAtZ(lastSpawnZ)
  }
}

function spawnObstaclesForChunk(backZ, frontZ) {
  for (let z = backZ; z > frontZ; z -= ROW_SPACING) {
    spawnRowAtZ(z)
  }
}

// --- Collision (XZ distance) and game state ---
let gameOver = false
let victory = false
let victoryWall = null

function distanceXZ(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz)
}

function disposeObstacle(ob) {
  scene.remove(ob.mesh)
  ob.mesh.geometry?.dispose()
  ob.mesh.material?.dispose()
}

let cameraShakeAmount = 0

function triggerCameraShake() {
  cameraShakeAmount = 0.4
}

function checkCollisions() {
  const px = player.position.x
  const pz = player.position.z
  const playerScore = player.score
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const ob = obstacles[i]
    const dist = distanceXZ(px, pz, ob.mesh.position.x, ob.mesh.position.z)
    const hitRadius = ob.type === 'division' ? 2.5 : COLLIDE_RADIUS
    if (dist < hitRadius) {
      if (ob.type === 'division') {
        player.score = Math.max(1, Math.floor(player.score / 2))
        updatePlayerMesh(player.score)
        disposeObstacle(ob)
        obstacles.splice(i, 1)
        triggerCameraShake()
      } else if (ob.value < 0) {
        player.score += ob.value
        updatePlayerMesh(player.score)
        disposeObstacle(ob)
        obstacles.splice(i, 1)
        triggerCameraShake()
        if (player.score < 0) {
          gameOver = true
          if (gameOverScreen) gameOverScreen.classList.add('active')
          return
        }
      } else if (ob.value <= playerScore) {
        player.score += ob.value
        updatePlayerMesh(player.score)
        disposeObstacle(ob)
        obstacles.splice(i, 1)
      } else {
        player.score -= ob.value
        updatePlayerMesh(player.score)
        disposeObstacle(ob)
        obstacles.splice(i, 1)
        triggerCameraShake()
        if (player.score < 0) {
          gameOver = true
          if (gameOverScreen) gameOverScreen.classList.add('active')
          return
        }
      }
    }
  }
}

function removeOffscreenObstacles() {
  const behind = player.position.z + 5
  for (let i = obstacles.length - 1; i >= 0; i--) {
    if (obstacles[i].mesh.position.z > behind) {
      disposeObstacle(obstacles[i])
      obstacles.splice(i, 1)
    }
  }
}

// --- Victory: giant 300 wall, particle explosion, overlay ---
function spawnVictoryWall(z) {
  if (!loadedFont || victoryWall) return
  const geometry = new TextGeometry('300', {
    font: loadedFont,
    size: 5,
    depth: 1.2,
    curveSegments: 12,
    bevelEnabled: true,
    bevelThickness: 0.2,
    bevelSize: 0.15,
    bevelSegments: 5,
  })
  geometry.center()
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xffd700 })
  )
  mesh.position.set(0, 2, z)
  mesh.castShadow = true
  scene.add(mesh)
  victoryWall = { mesh, z }
}

function createParticleExplosion(x, y, z) {
  const count = 80
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const velocities = []
  for (let i = 0; i < count; i++) {
    positions[i * 3] = x + (Math.random() - 0.5) * 2
    positions[i * 3 + 1] = y + (Math.random() - 0.5) * 2
    positions[i * 3 + 2] = z + (Math.random() - 0.5) * 2
    velocities.push({
      vx: (Math.random() - 0.5) * 20,
      vy: (Math.random() - 0.5) * 20,
      vz: (Math.random() - 0.5) * 20,
    })
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: 0xffd700,
    size: 0.3,
    transparent: true,
    opacity: 0.9,
  })
  const points = new THREE.Points(geometry, material)
  points.userData.velocities = velocities
  points.userData.life = 1
  scene.add(points)
  return points
}

const victoryParticles = []

function updateVictoryParticles(delta) {
  for (let i = victoryParticles.length - 1; i >= 0; i--) {
    const points = victoryParticles[i]
    const pos = points.geometry.attributes.position
    const vels = points.userData.velocities
    points.userData.life -= delta * 2
    if (points.userData.life <= 0) {
      scene.remove(points)
      points.geometry.dispose()
      points.material.dispose()
      victoryParticles.splice(i, 1)
      continue
    }
    points.material.opacity = points.userData.life
    for (let j = 0; j < pos.count; j++) {
      pos.array[j * 3] += vels[j].vx * delta
      pos.array[j * 3 + 1] += vels[j].vy * delta
      pos.array[j * 3 + 2] += vels[j].vz * delta
    }
    pos.needsUpdate = true
  }
}

function checkVictoryWallCollision() {
  if (!victoryWall) return
  const dist = distanceXZ(
    player.position.x,
    player.position.z,
    victoryWall.mesh.position.x,
    victoryWall.mesh.position.z
  )
  if (dist < 4) {
    victory = true
    const pos = victoryWall.mesh.position
    victoryParticles.push(createParticleExplosion(pos.x, pos.y, pos.z))
    scene.remove(victoryWall.mesh)
    victoryWall.mesh.geometry?.dispose()
    victoryWall.mesh.material?.dispose()
    victoryWall = null
    if (levelComplete) levelComplete.classList.add('active')
  }
}

// --- Camera (behind and above, follows Z only) ---
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000)
let cameraHeight = CAMERA_HEIGHT_DEFAULT
let cameraZOffset = CAMERA_Z_OFFSET_DEFAULT

function adjustCameraForMobile() {
  const aspect = window.innerWidth / window.innerHeight
  const fovRad = (camera.fov * Math.PI) / 180
  const halfFov = fovRad / 2
  // Visible width at player plane = 2 * distance * tan(halfFov) * aspect. Need >= ROAD_WIDTH.
  const minDistance = ROAD_WIDTH / (2 * Math.tan(halfFov) * aspect)
  const viewDistance = Math.sqrt(1 + CAMERA_HEIGHT_RATIO * CAMERA_HEIGHT_RATIO)
  const requiredZOffset = minDistance / viewDistance
  // Pull back (and up) when narrow aspect (e.g. portrait) so full road width fits
  cameraZOffset = Math.max(CAMERA_Z_OFFSET_DEFAULT, requiredZOffset)
  cameraHeight = 0.5 + cameraZOffset * CAMERA_HEIGHT_RATIO
}

camera.position.set(0, cameraHeight, cameraZOffset)
camera.lookAt(0, 0, -20)
scene.add(camera)
adjustCameraForMobile()

// --- Renderer ---
const canvas = document.createElement('canvas')
document.querySelector('#app').innerHTML = ''
document.querySelector('#app').appendChild(canvas)
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

// --- UI Elements ---
const startScreen = document.getElementById('start-screen')
const hud = document.getElementById('game-hud')
const startBtn = document.getElementById('start-btn')
const levelComplete = document.getElementById('level-complete')
const nextLevelBtn = document.getElementById('next-level-btn')
const gameOverScreen = document.getElementById('game-over')
const tryAgainBtn = document.getElementById('try-again-btn')
const watchAdBtn = document.getElementById('watch-ad-btn')
const pauseBtn = document.getElementById('pause-btn')
const resumeBtn = document.getElementById('resume-btn')
const pauseOverlay = document.getElementById('pause-overlay')

let isGameRunning = false
let isPaused = false

function restartLevel() {
  victory = false
  victoryWall = null
  gameOver = false
  isPaused = false
  if (gameOverScreen) gameOverScreen.classList.remove('active')
  if (pauseOverlay) pauseOverlay.classList.remove('active')
  player.score = 1
  player.position.set(0, 0.5, 0)
  obstacles.forEach((ob) => {
    scene.remove(ob.mesh)
    ob.mesh.geometry?.dispose()
    ob.mesh.material?.dispose()
  })
  obstacles.length = 0
  lastSpawnZ = 0
  victoryParticles.forEach((p) => {
    scene.remove(p)
    p.geometry.dispose()
    p.material.dispose()
  })
  victoryParticles.length = 0
  roadChunks.forEach((c) => scene.remove(c.mesh))
  roadChunks.length = 0
  initRoadManager()
  updatePlayerMesh(1)
}

if (nextLevelBtn) {
  nextLevelBtn.addEventListener('click', () => {
    if (levelComplete) levelComplete.classList.remove('active')
    restartLevel()
  })
}

if (tryAgainBtn) {
  tryAgainBtn.addEventListener('click', () => {
    if (gameOverScreen) gameOverScreen.classList.remove('active')
    restartLevel()
  })
}

if (watchAdBtn) {
  watchAdBtn.addEventListener('click', () => {
    watchAdBtn.disabled = true
    watchAdBtn.textContent = 'Ad playing...'
    setTimeout(() => {
      gameOver = false
      player.score = 1
      updatePlayerMesh(1)
      if (gameOverScreen) gameOverScreen.classList.remove('active')
      watchAdBtn.disabled = false
      watchAdBtn.textContent = 'Watch Ad to Resume'
    }, 2000)
  })
}

function startGame() {
  isGameRunning = true

  // Hide Start Screen
  startScreen.style.opacity = '0'
  setTimeout(() => {
    startScreen.style.display = 'none'
  }, 500)

  // Show HUD
  hud.style.opacity = '1'
}

if (startBtn) startBtn.addEventListener('click', startGame)

if (pauseBtn) {
  pauseBtn.addEventListener('click', () => {
    if (!isGameRunning || gameOver || victory) return
    isPaused = true
    if (pauseOverlay) pauseOverlay.classList.add('active')
  })
}

if (resumeBtn) {
  resumeBtn.addEventListener('click', () => {
    isPaused = false
    if (pauseOverlay) pauseOverlay.classList.remove('active')
  })
}

// --- Swerve state (mouse & touch) ---
let isPointerDown = false
let lastClientX = 0
const roadSpan = ROAD_X_MAX - ROAD_X_MIN
const SWIPE_SENSITIVITY_MOBILE = 2 // on touch devices, same swipe moves player 2x further for easier edge reach
function isMobileDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}
function getSwipeSensitivity() {
  return isMobileDevice() ? SWIPE_SENSITIVITY_MOBILE : 1
}

function getClientX(e) {
  return e.touches ? e.touches[0].clientX : e.clientX
}

function onPointerDown(e) {
  if (gameOver || victory || isPaused || !isGameRunning) return
  isPointerDown = true
  lastClientX = getClientX(e)
}

function onPointerMove(e) {
  if (!isPointerDown) return
  const clientX = getClientX(e)
  const deltaX = clientX - lastClientX
  lastClientX = clientX
  const sensitivity = getSwipeSensitivity()
  const worldDelta = (deltaX / window.innerWidth) * roadSpan * sensitivity
  player.position.x = THREE.MathUtils.clamp(player.position.x + worldDelta, ROAD_X_MIN, ROAD_X_MAX)
}

function onPointerUp() {
  isPointerDown = false
}

canvas.addEventListener('mousedown', onPointerDown)
canvas.addEventListener('mousemove', onPointerMove)
canvas.addEventListener('mouseup', onPointerUp)
canvas.addEventListener('mouseleave', onPointerUp)
canvas.addEventListener('touchstart', onPointerDown, { passive: true })
canvas.addEventListener('touchmove', onPointerMove, { passive: true })
canvas.addEventListener('touchend', onPointerUp)
canvas.addEventListener('touchcancel', onPointerUp)

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  adjustCameraForMobile()
})

// --- Animation ---
const clock = new THREE.Clock()
function animate() {
  requestAnimationFrame(animate)
  const delta = clock.getDelta()

  if (isGameRunning && !gameOver && !victory && !isPaused) {
    // Victory: spawn wall when score >= 300, stop normal spawning
    if (player.score >= VICTORY_TARGET && !victoryWall) {
      spawnVictoryWall(player.position.z - VICTORY_WALL_AHEAD)
    }
    if (!victoryWall) {
      levelGenerator(player.position.z)
    }

    // Auto-run
    player.position.z -= RUN_SPEED * delta

    // Leapfrog road chunks
    const cameraZ = player.position.z + cameraZOffset
    updateRoadManager(player.position.z, cameraZ)
    removeOffscreenObstacles()
    checkCollisions()
    checkVictoryWallCollision()

    // Keep player clamped to road (safety)
    player.position.x = THREE.MathUtils.clamp(player.position.x, ROAD_X_MIN, ROAD_X_MAX)

    // Moving floor: scroll grid texture based on player Z
    roadGridTexture.offset.y = (Math.abs(player.position.z) % 200) / 200

    // Camera follow (Z only)
    const targetCamZ = player.position.z + cameraZOffset
    camera.position.z += (targetCamZ - camera.position.z) * CAMERA_LERP
    camera.position.x = 0
    camera.position.y = cameraHeight
    camera.lookAt(0, 0, player.position.z - 15)
  }

  if (cameraShakeAmount > 0) {
    camera.position.x += (Math.random() - 0.5) * cameraShakeAmount
    camera.position.y += (Math.random() - 0.5) * cameraShakeAmount
    cameraShakeAmount = Math.max(0, cameraShakeAmount - delta * 3)
  }

  updateVictoryParticles(delta)

  renderer.render(scene, camera)
}
animate()
