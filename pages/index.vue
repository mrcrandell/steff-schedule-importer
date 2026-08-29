<template>
  <main class="container">
    <h1>STEFF Schedule Importer</h1>
    <p class="subtitle">Upload an image or PDF of the work schedule to extract STEFF's shifts and sync them to Google Calendar.</p>

    <!-- File upload area -->
    <section
      class="drop-zone"
      :class="{ 'drop-zone--active': isDragging }"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="onDrop"
    >
      <input
        ref="fileInputRef"
        type="file"
        accept="image/*,application/pdf"
        class="drop-zone__input"
        @change="onFileChange"
      />
      <div v-if="selectedFile" class="drop-zone__info">
        <span class="drop-zone__filename">{{ selectedFile.name }}</span>
        <button class="btn btn--ghost btn--sm" @click.prevent="clearFile">✕ Remove</button>
      </div>
      <div v-else class="drop-zone__placeholder">
        <span>Drag &amp; drop an image or PDF here, or</span>
        <button class="btn btn--outline btn--sm" @click.prevent="fileInputRef?.click()">Browse file</button>
      </div>
    </section>

    <!-- Parse button -->
    <div class="actions">
      <button
        class="btn btn--primary"
        :disabled="!selectedFile || isParsing"
        @click="parseSchedule"
      >
        <span v-if="isParsing">Parsing…</span>
        <span v-else>Parse Schedule</span>
      </button>
    </div>

    <!-- Error message -->
    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

    <!-- Results table -->
    <section v-if="shifts.length > 0" class="results">
      <h2>Parsed Shifts for STEFF ({{ shifts.length }})</h2>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Original Start</th>
              <th>Original End</th>
              <th>Rounded Start</th>
              <th>End (ISO)</th>
              <th>Rounded?</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="shift in shifts" :key="shift.date + shift.rawStartTime">
              <td>{{ shift.date }}</td>
              <td>{{ shift.rawStartTime }}</td>
              <td>{{ shift.rawEndTime }}</td>
              <td :class="{ 'cell--rounded': shift.startWasRounded }">
                {{ formatISO(shift.startISO) }}
              </td>
              <td>{{ formatISO(shift.endISO) }}</td>
              <td class="cell--center">
                <span v-if="shift.startWasRounded" title="Start time was rounded up from :45">⚡</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Sync button -->
      <div class="actions actions--right">
        <button
          class="btn btn--success"
          :disabled="isSyncing"
          @click="syncToCalendar"
        >
          <span v-if="isSyncing">Syncing…</span>
          <span v-else>Sync to Google Calendar</span>
        </button>
      </div>

      <!-- Sync result -->
      <p v-if="syncMessage" class="sync-message" :class="{ 'sync-message--error': syncHasError }">
        {{ syncMessage }}
      </p>
    </section>

  </main>
</template>

<script setup lang="ts">
interface NormalizedShift {
  date: string
  rawStartTime: string
  rawEndTime: string
  startISO: string
  endISO: string
  startWasRounded: boolean
}

interface GoogleTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

interface GoogleTokenClient {
  callback: ((response: GoogleTokenResponse) => void) | null
  requestAccessToken: (options?: { prompt?: string }) => void
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (options: {
            client_id: string
            scope: string
            callback: (response: GoogleTokenResponse) => void
          }) => GoogleTokenClient
        }
      }
    }
  }
}

const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'

const fileInputRef = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const isDragging = ref(false)
const isParsing = ref(false)
const isSyncing = ref(false)
const shifts = ref<NormalizedShift[]>([])
const errorMessage = ref('')
const syncMessage = ref('')
const syncHasError = ref(false)
// In-memory OAuth access token obtained via the Google OAuth flow.
// This is intentionally NOT stored in localStorage or on window to reduce
// the attack surface for token theft.
const googleAccessToken = ref('')
const runtimeConfig = useRuntimeConfig()
const googleClientId = runtimeConfig.public.googleClientId
let googleTokenClient: GoogleTokenClient | null = null
let googleScriptPromise: Promise<void> | null = null

useHead({
  script: [
    {
      src: 'https://accounts.google.com/gsi/client',
      async: true,
      defer: true,
    },
  ],
})

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.[0]) {
    selectedFile.value = input.files[0]
    shifts.value = []
    errorMessage.value = ''
    syncMessage.value = ''
  }
}

function onDrop(event: DragEvent) {
  isDragging.value = false
  const file = event.dataTransfer?.files[0]
  if (file) {
    selectedFile.value = file
    shifts.value = []
    errorMessage.value = ''
    syncMessage.value = ''
  }
}

function clearFile() {
  selectedFile.value = null
  shifts.value = []
  errorMessage.value = ''
  syncMessage.value = ''
  if (fileInputRef.value) fileInputRef.value.value = ''
}

async function parseSchedule() {
  if (!selectedFile.value) return
  isParsing.value = true
  errorMessage.value = ''
  shifts.value = []

  try {
    const form = new FormData()
    form.append('file', selectedFile.value)

    const data = await $fetch<NormalizedShift[]>('/api/parse-schedule', {
      method: 'POST',
      body: form,
    })
    shifts.value = data
    if (data.length === 0) {
      errorMessage.value = 'No shifts found for STEFF in this schedule.'
    }
  } catch (err: unknown) {
    errorMessage.value =
      err instanceof Error ? err.message : 'An unexpected error occurred while parsing the schedule.'
  } finally {
    isParsing.value = false
  }
}

async function syncToCalendar() {
  if (shifts.value.length === 0) return
  isSyncing.value = true
  syncMessage.value = ''
  syncHasError.value = false

  try {
    if (!googleAccessToken.value) {
      googleAccessToken.value = await requestGoogleAccessToken()
    }

    await $fetch('/api/sync-calendar', {
      method: 'POST',
      body: {
        shifts: shifts.value,
        accessToken: googleAccessToken.value,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    })
    syncMessage.value = `Successfully synced ${shifts.value.length} shift(s) to Google Calendar!`
  } catch (err: unknown) {
    googleAccessToken.value = ''
    syncHasError.value = true
    syncMessage.value =
      err instanceof Error ? err.message : 'An unexpected error occurred while syncing to Google Calendar.'
  } finally {
    isSyncing.value = false
  }
}

async function requestGoogleAccessToken(): Promise<string> {
  if (!googleClientId) {
    throw new Error('GOOGLE_CLIENT_ID is not available to the browser. Restart the app after updating .env.')
  }

  await ensureGoogleIdentityScript()

  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services failed to load.')
  }

  if (!googleTokenClient) {
    googleTokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: googleClientId,
      scope: GOOGLE_CALENDAR_SCOPE,
      callback: () => {},
    })
  }

  return await new Promise<string>((resolve, reject) => {
    if (!googleTokenClient) {
      reject(new Error('Google OAuth client could not be initialized.'))
      return
    }

    googleTokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error_description || response.error))
        return
      }

      if (!response.access_token) {
        reject(new Error('Google OAuth did not return an access token.'))
        return
      }

      resolve(response.access_token)
    }

    googleTokenClient.requestAccessToken({
      prompt: googleAccessToken.value ? '' : 'consent',
    })
  })
}

async function ensureGoogleIdentityScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) {
    return
  }

  if (!googleScriptPromise) {
    googleScriptPromise = new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')

      const onLoad = () => resolve()
      const onError = () => reject(new Error('Failed to load Google Identity Services.'))

      if (existingScript) {
        existingScript.addEventListener('load', onLoad, { once: true })
        existingScript.addEventListener('error', onError, { once: true })
        return
      }

      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.addEventListener('load', onLoad, { once: true })
      script.addEventListener('error', onError, { once: true })
      document.head.appendChild(script)
    })
  }

  await googleScriptPromise
}

/** Format an ISO local datetime to a human-readable time string */
function formatISO(iso: string): string {
  const [, timePart] = iso.split('T')
  if (!timePart) return iso
  const [hh, mm] = timePart.split(':')
  const hours = parseInt(hh, 10)
  const minutes = mm
  const meridiem = hours >= 12 ? 'PM' : 'AM'
  const h12 = hours % 12 || 12
  return `${h12}:${minutes} ${meridiem}`
}
</script>

<style>
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #f5f5f5;
  color: #1a1a1a;
  line-height: 1.6;
}

.container {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

h1 {
  font-size: 1.8rem;
  margin-bottom: 0.25rem;
}

.subtitle {
  color: #555;
  margin-bottom: 1.75rem;
}

/* Drop zone */
.drop-zone {
  position: relative;
  border: 2px dashed #bbb;
  border-radius: 12px;
  padding: 2.5rem 1.5rem;
  text-align: center;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

.drop-zone--active {
  border-color: #4f46e5;
  background: #eef2ff;
}

.drop-zone__input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  width: 100%;
  height: 100%;
}

.drop-zone__placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  color: #666;
}

.drop-zone__info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.drop-zone__filename {
  font-weight: 500;
}

/* Actions */
.actions {
  margin-top: 1.25rem;
  display: flex;
  gap: 1rem;
}

.actions--right {
  justify-content: flex-end;
}

/* Buttons */
.btn {
  padding: 0.55rem 1.25rem;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn--primary {
  background: #4f46e5;
  color: #fff;
}

.btn--success {
  background: #16a34a;
  color: #fff;
}

.btn--outline {
  background: transparent;
  border: 2px solid #4f46e5;
  color: #4f46e5;
}

.btn--ghost {
  background: transparent;
  color: #888;
}

.btn--sm {
  padding: 0.3rem 0.75rem;
  font-size: 0.85rem;
}

/* Error / sync messages */
.error-message {
  margin-top: 0.75rem;
  color: #dc2626;
  font-size: 0.9rem;
}

.sync-message {
  margin-top: 0.75rem;
  color: #16a34a;
  font-size: 0.9rem;
}

.sync-message--error {
  color: #dc2626;
}

/* Results */
.results {
  margin-top: 2rem;
}

.results h2 {
  margin-bottom: 1rem;
  font-size: 1.2rem;
}

.table-wrapper {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.9rem;
}

th,
td {
  padding: 0.65rem 0.9rem;
  text-align: left;
  border-bottom: 1px solid #e5e7eb;
}

th {
  background: #f9fafb;
  font-weight: 600;
  color: #374151;
}

tr:last-child td {
  border-bottom: none;
}

.cell--rounded {
  color: #4f46e5;
  font-weight: 600;
}

.cell--center {
  text-align: center;
}

</style>
