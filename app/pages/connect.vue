<template>
  <div class="max-w-xl mx-auto px-4 py-12">
    <div class="flex flex-col gap-6">
      <div>
        <h1 class="text-2xl font-bold text-highlighted">Connect a host</h1>
        <p class="text-muted text-sm mt-1">
          In the Orca desktop app open <span class="text-highlighted">Settings → Mobile</span> and copy the
          pairing code under the QR — it starts with <code class="text-xs">orca://pair?code=…</code>.
          For a headless <code class="text-xs">orca serve</code> host, copy the pairing URL from its
          startup output.
        </p>
      </div>

      <UForm class="flex flex-col gap-4" :state="form" @submit="onSubmit">
        <UFormField label="Pairing code or URL" name="code" hint="Never leaves this browser">
          <UTextarea
            v-model="form.code"
            placeholder="orca://pair?code=eyJlbmRwb2ludCI6…"
            :rows="3"
            class="w-full"
            autofocus
          />
        </UFormField>

        <UAlert
          v-if="error"
          icon="i-lucide-triangle-alert"
          color="error"
          variant="subtle"
          :description="error"
        />

        <div class="flex items-center gap-3">
          <UButton type="submit" icon="i-lucide-link" label="Pair and connect" :loading="pairing" />
          <UButton
            to="/"
            color="neutral"
            variant="soft"
            icon="i-lucide-arrow-left"
            label="Cancel"
            :disabled="pairing"
          />
        </div>
      </UForm>

      <USeparator />

      <!-- Host list -->
      <div class="flex flex-col gap-2">
        <h2 class="text-sm font-semibold text-highlighted">Paired hosts</h2>
        <div
          v-for="host in store.hosts"
          :key="host.hostId"
          class="flex items-center gap-3 border border-default rounded-lg px-3 py-2"
        >
          <span class="i-lucide-hard-drive text-lg text-muted" aria-hidden />
          <div class="flex-1 min-w-0">
            <div class="text-sm text-highlighted truncate">{{ host.label }}</div>
            <div class="text-xs text-dimmed truncate font-mono">{{ host.endpoint }}</div>
          </div>
          <UTooltip text="Connect">
            <UButton
              icon="i-lucide-plug"
              size="xs"
              color="neutral"
              variant="soft"
              :loading="store.connections[host.hostId]?.phase === 'connecting'"
              @click="connect(host.hostId)"
            />
          </UTooltip>
          <UTooltip text="Remove">
            <UButton
              icon="i-lucide-trash-2"
              size="xs"
              color="error"
              variant="soft"
              @click="store.removeHost(host.hostId)"
            />
          </UTooltip>
        </div>
        <p v-if="store.hosts.length === 0" class="text-xs text-dimmed">No hosts paired yet.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useOrcaHosts } from '~/stores/hosts'
import { decodePairingUrl, type PairingOffer } from '@shared/pairing'

useHead({ title: 'Connect a host' })

const store = useOrcaHosts()
const router = useRouter()

const form = reactive({ code: '' })
const error = ref('')
const pairing = ref(false)

onMounted(() => store.init())

async function onSubmit() {
  error.value = ''
  pairing.value = true
  try {
    const offer = decodePairingUrl(form.code)
    if (!offer) {
      throw new Error(
        'Not a valid pairing code — copy it again from Settings → Mobile, or from the orca serve startup output.',
      )
    }
    await pair(offer)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    pairing.value = false
  }
}

async function pair(offer: PairingOffer) {
  const hostId = store.addHostFromOffer(offer)
  await store.connect(hostId)
  router.push('/')
}

async function connect(hostId: string) {
  try {
    await store.connect(hostId)
    router.push('/')
  } catch {
    // the store records the failure on the index page badge/log
  }
}
</script>
