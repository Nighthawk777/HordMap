// Skin Creator functionality
// API Base URL - backend server (auto-detect based on hostname)
function getApiBaseUrl() {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        const port = window.location.port;
        if (port === '3003') return 'http://localhost:5003';  // nerfofficial
        if (port === '3002') return 'http://localhost:5002';  // nerfdev
        if (port === '3001') return 'http://localhost:5001';  // old demo
        if (port === '3000') return 'http://localhost:7778';  // demo/localhost
        return 'http://localhost:5000';
    } else if (window.location.hostname.includes('nerfdev.org')) {
        return 'https://api.nerfdev.org';
    } else if (window.location.hostname.includes('nerfofficial.org')) {
        return 'https://api.nerfofficial.org';
    }
    return 'https://api.nerfofficial.org';
}
const API_BASE_URL = getApiBaseUrl();

/** Convert a single sRGB channel (0–1 as stored in CSS/hex bytes) to linear for PBR albedo. */
function skinSrgbChannelToLinear(s) {
    const x = Number(s);
    if (!Number.isFinite(x)) return 0;
    if (x <= 0.04045) return x / 12.92;
    return Math.pow((x + 0.055) / 1.055, 2.4);
}

/** Hard cap for glitch linear RGB channels (matches backend / saved payloads). */
const GLITCH_SKIN_LINEAR_MIN = -1000000;
const GLITCH_SKIN_LINEAR_MAX = 1000000;

function clampGlitchLinearChannel(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.min(GLITCH_SKIN_LINEAR_MAX, Math.max(GLITCH_SKIN_LINEAR_MIN, n));
}

/** Parse RGB field text (supports `0,88` European decimals). */
function skinParseRgbFieldNumber(raw) {
    if (raw == null || raw === '') return NaN;
    const s = String(raw).trim().replace(/,/g, '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
}

/** Raw finite vec3 for manifest body slots — matches Oasis setRGB(r,g,b) on skin uniforms. */
function skinRgbToOasisVec3(r, g, b) {
    const R = Number(r),
        G = Number(g),
        B = Number(b);
    return new THREE.Vector3(
        Number.isFinite(R) ? R : 0,
        Number.isFinite(G) ? G : 0,
        Number.isFinite(B) ? B : 0
    );
}

/** Preview / hex folding: map any float channel to 0–255 (wrap), same as legacy `*255` mod. */
function glitchChannelToDisplayByte(v) {
    const x = Number(v);
    if (!Number.isFinite(x)) return 0;
    return ((Math.round(x * 255) % 256) + 256) % 256;
}

/** Map arbitrary float channels to 0–255 for canvas preview (wrapping). */
function glitchFloatToPreviewByte(v) {
    return glitchChannelToDisplayByte(v);
}

/** All pigment color input ids (order matches UI). */
const SKIN_COLOR_INPUT_IDS = [
    'maleDisplayColor',
    'markingsColor',
    'bodyColor',
    'flankColor',
    'underbellyColor',
    'detail1Color',
    'eyesColor'
];

/** Oasis-style rig — used only in glitch mode (NoToneMapping preserves float tint separation). */
const OASIS_SKIN_VIEWER_AMBIENT_COLOR = 0xffffff;
const OASIS_SKIN_VIEWER_AMBIENT_INTENSITY = 0.2;
const OASIS_SKIN_VIEWER_KEY_COLOR = 0xfff4a0;
const OASIS_SKIN_VIEWER_KEY_INTENSITY = 2.35;
const OASIS_SKIN_VIEWER_KEY_POSITION = { x: 0, y: 10, z: 2 };

/** Normal skins — UE-ish outdoor read: higher fill + exposure so dark pigments stay vivid, not muddy. */
const UE5_SKIN_VIEWER_AMBIENT_COLOR = 0xf2f4fb;
const UE5_SKIN_VIEWER_AMBIENT_INTENSITY = 0.11;
const UE5_SKIN_VIEWER_HEMI_SKY = 0xd4e4ff;
const UE5_SKIN_VIEWER_HEMI_GROUND = 0x5c4a42;
const UE5_SKIN_VIEWER_HEMI_INTENSITY = 0.5;
const UE5_SKIN_VIEWER_SUN_COLOR = 0xfffbef;
const UE5_SKIN_VIEWER_SUN_INTENSITY = 1.72;
const UE5_SKIN_VIEWER_SUN_POSITION = { x: 4.2, y: 11, z: 4.5 };
const UE5_SKIN_TONE_MAPPING_EXPOSURE = 1.06;

/** Skin code / preset fields kept for backward compatibility; lighting is fixed. */
const OASIS_SKIN_EXPORT_SUN_AZIMUTH = '0';
const OASIS_SKIN_EXPORT_SUN_INTENSITY = '2';

/** Pixel ratio cap for sharper canvas on high-DPI displays (balance vs GPU cost). */
const SKIN_VIEWER_MAX_PIXEL_RATIO = 3;
/** Anisotropic filtering cap — improves tangent detail when the surface is viewed at a grazing angle. */
const SKIN_VIEWER_TEXTURE_ANISOTROPY_CAP = 16;

/** Known GLB clip names (order used when sorting clips for the dropdown). */
const SKIN_CREATOR_ANIMATION_LABELS = [
    'Idle', 'Sniff', 'Trot', 'Broadcast', 'Attract', 'Threaten', 'Danger'
];

function sortClipsByKnownAnimationOrder(clips) {
    const used = new Set();
    const ordered = [];
    for (const label of SKIN_CREATOR_ANIMATION_LABELS) {
        const want = label.toLowerCase();
        const found = clips.find((c) => (c.name || '').trim().toLowerCase() === want);
        if (found) {
            ordered.push(found);
            used.add(found);
        }
    }
    clips.forEach((c) => {
        if (!used.has(c)) {
            ordered.push(c);
        }
    });
    return ordered;
}

function labelForAnimationClip(clip, fallbackIndex) {
    const raw = (clip.name || '').trim();
    if (!raw) {
        return SKIN_CREATOR_ANIMATION_LABELS[fallbackIndex] || `Clip ${fallbackIndex + 1}`;
    }
    const lower = raw.toLowerCase();
    const canonical = SKIN_CREATOR_ANIMATION_LABELS.find((l) => l.toLowerCase() === lower);
    return canonical || raw;
}

function disposeSingleMaterial(material) {
    if (!material) return;
    ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'lightMap', 'bumpMap', 'displacementMap', 'specularMap'].forEach((k) => {
        const t = material[k];
        if (t && typeof t.dispose === 'function') t.dispose();
    });
    if (typeof material.dispose === 'function') material.dispose();
}

/** Linear RGB from manifest `Paramters.Colors` entry (matches Oasis `Z(B.TeethColor)`). */
function manifestLinearColorVec3(manifest, key, fallbackRgb) {
    const fb = fallbackRgb || [1, 1, 1];
    const cols =
        manifest &&
        manifest.BodyMaterial &&
        manifest.BodyMaterial.Paramters &&
        manifest.BodyMaterial.Paramters.Colors;
    const c = cols && cols[key];
    if (!c || typeof c.R !== 'number') {
        return new THREE.Vector3(fb[0], fb[1], fb[2]);
    }
    return new THREE.Vector3(c.R, c.G, c.B);
}

function disposeThreeObjectTree(root) {
    if (!root) return;
    root.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
            if (Array.isArray(object.material)) {
                object.material.forEach((material) => {
                    disposeSingleMaterial(material);
                });
            } else {
                disposeSingleMaterial(object.material);
            }
        }
    });
}

/** Oasis / tio.gg skin shader — multiplicative masks, base CMY under pattern, albedo last. */
const SKIN_SHADER_PREAMBLE = `
uniform sampler2D uSkinBaseMask;
uniform sampler2D uSkinPattern;
uniform sampler2D uSkinAlbedo;
uniform sampler2D uSkinOrigMap;
uniform vec3 uTeethColor;
uniform vec3 uMouthColor;
uniform vec3 uClawColor;
uniform vec3 uColMaleDisplay;
uniform vec3 uColUnderbelly;
uniform vec3 uColFlank;
uniform vec3 uColBody;
uniform vec3 uColMarkings;
uniform vec3 uColDetail;
uniform float uSkinPatternNeutralGray;
uniform float uSkinManifestDiffuseGain;
uniform float uSkinPreviewSaturation;
`;

/** Glitch preview — unchanged from legacy Oasis shader tuning (paired with NoToneMapping). */
const SKIN_GLITCH_PATTERN_NEUTRAL_GRAY = 0.88;
const SKIN_GLITCH_MANIFEST_DIFFUSE_GAIN = 0.56;
const SKIN_GLITCH_PREVIEW_SATURATION = 1.0;

/** Normal skins — lift unmasked pattern base slightly + more diffuse so dark slots read saturated. */
const SKIN_NORMAL_PATTERN_NEUTRAL_GRAY = 0.72;
const SKIN_NORMAL_MANIFEST_DIFFUSE_GAIN = 0.68;
const SKIN_NORMAL_PREVIEW_SATURATION = 1.18;

const SKIN_MAP_FRAGMENT_REPLACE = `
#ifdef USE_MAP
	vec3 bm = texture2D( uSkinBaseMask, vUv ).rgb;
	vec3 pm = texture2D( uSkinPattern, vUv ).rgb;
	vec3 alb = texture2D( uSkinAlbedo, vUv ).rgb;

	float bmR = bm.r * (1.0 - bm.g) * (1.0 - bm.b);
	float bmG = bm.g * (1.0 - bm.r) * (1.0 - bm.b);
	float bmB = bm.b * (1.0 - bm.r) * (1.0 - bm.g);
	float bmC = bm.g * bm.b * (1.0 - bm.r);
	float bmM = bm.r * bm.b * (1.0 - bm.g);
	float bmY = bm.r * bm.g * (1.0 - bm.b);

	// Neutral base before mask tints; separate values for normal (UE preview) vs glitch in JS.
	vec3 color = vec3(uSkinPatternNeutralGray);
	color = mix(color, uColBody, bmC);
	color = mix(color, uColMarkings, bmM);
	color = mix(color, uColDetail, bmY);

	float fR = pm.r * (1.0 - pm.g) * (1.0 - pm.b);
	float fG = pm.g * (1.0 - pm.r) * (1.0 - pm.b);
	float fB = pm.b * (1.0 - pm.r) * (1.0 - pm.g);
	float fC = pm.g * pm.b * (1.0 - pm.r);
	float fM = pm.r * pm.b * (1.0 - pm.g);
	float fY = pm.r * pm.g * (1.0 - pm.b);

	color = mix(color, uColMaleDisplay, fR);
	color = mix(color, uColUnderbelly, fG);
	color = mix(color, uColFlank, fB);
	color = mix(color, uColBody, fC);
	color = mix(color, uColMarkings, fM);
	color = mix(color, uColDetail, fY);

	color = mix(color, uTeethColor, bmR);
	color = mix(color, uMouthColor, bmG);
	color = mix(color, uClawColor, bmB);

	// Normal mode: nudge chroma so deep browns/reds don’t collapse to gray under ACES + fill (glitch = 1.0).
	float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
	color = mix(vec3(luma), color, uSkinPreviewSaturation);

	float origA = texture2D( uSkinOrigMap, vUv ).a;
	diffuseColor.rgb = color * alb * uSkinManifestDiffuseGain;
	diffuseColor.a = origA;
#endif
`;

function resolvePatternEntryFromManifest(manifest, ageStage, patternIndex) {
    const tex = manifest && manifest.BodyMaterial && manifest.BodyMaterial.Textures;
    if (!tex) return null;
    if (ageStage === 'Adult') {
        const arr = tex.AdultPatterns || [];
        if (!arr.length) return null;
        const n = parseInt(patternIndex, 10);
        const i = Number.isFinite(n) ? Math.min(Math.max(0, n), arr.length - 1) : 0;
        return arr[i];
    }
    if (ageStage === 'Juvenile') return tex.JuvenilePattern || null;
    return tex.HatchlingPattern || null;
}

window.SkinCreator = window.SkinCreator || {
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    model: null,
    modelViewer: null,
    isInitialized: false,
    isRotating: true,
    PRESET_KEY: 'dino_skin_presets',
    PRESET_KEY_GLITCH: 'dino_skin_presets_glitch',
    animationId: null,
    _modelLoadToken: 0,
    _updateColorsToken: 0,
    _currentSkinManifest: null,
    _manifestSkinTextureKey: null,
    _manifestSharedColorUniforms: null,
    _manifestSharedPresentationUniforms: null,
    _manifestColorRefreshRaf: null,
    _gltfBaseMapSource: null,
    _whiteFallbackMap: null,
    initRetries: 0,
    maxInitRetries: 10,
    sunLight: null,
    ambientLight: null,
    hemisphereLight: null,
    groundMesh: null,
    mixer: null,
    clock: null,
    gltfAnimationClips: [],

    init() {
        if (this.isInitialized && this.scene && this.renderer) {
            return;
        }

        if (typeof THREE === 'undefined') {
            this.initRetries++;
            if (this.initRetries < this.maxInitRetries) {
                setTimeout(() => this.init(), 300);
            }
            return;
        }

        if (!THREE.OrbitControls || !THREE.OBJLoader || !THREE.GLTFLoader) {
            this.initRetries++;
            if (this.initRetries < this.maxInitRetries) {
                setTimeout(() => this.init(), 300);
            }
            return;
        }

        this.modelViewer = document.getElementById('modelViewer');
        if (!this.modelViewer) {
            this.initRetries++;
            if (this.initRetries < this.maxInitRetries) {
                setTimeout(() => this.init(), 300);
            }
            return;
        }

        this.modelViewer.querySelectorAll('canvas').forEach((c) => c.remove());
        this.initRetries = 0;

        this.scene = new THREE.Scene();

        const w = this.modelViewer.offsetWidth || this.modelViewer.clientWidth || 800;
        const h = this.modelViewer.offsetHeight || this.modelViewer.clientHeight || 700;

        this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
        this.camera.position.z = 3;

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setClearColor(0x000000, 0);
        if (THREE.sRGBEncoding !== undefined) {
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        }
        if (THREE.NoToneMapping !== undefined) {
            this.renderer.toneMapping = THREE.NoToneMapping;
        }
        if (this.renderer.toneMappingExposure !== undefined) {
            this.renderer.toneMappingExposure = 1;
        }
        if (this.renderer.outputColorSpace !== undefined && THREE.SRGBColorSpace !== undefined) {
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        }
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(
            Math.min(window.devicePixelRatio || 1, SKIN_VIEWER_MAX_PIXEL_RATIO)
        );
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        this.modelViewer.appendChild(this.renderer.domElement);

        setTimeout(() => {
            this.onWindowResize();
        }, 100);
        
        this._boundResize = this.onWindowResize.bind(this);
        window.addEventListener('resize', this._boundResize);
        
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.enableZoom = true;
        this.controls.autoRotate = this.isRotating;
        this.controls.autoRotateSpeed = 1.5;

        this._installLighting();

        this.clock = new THREE.Clock();

        this.loadModel('Allosaurus');
        
        this.animate();
        this.isInitialized = true;
    },

    cleanup() {
        this._modelLoadToken = (this._modelLoadToken || 0) + 1;

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        if (this._boundResize) {
            window.removeEventListener('resize', this._boundResize);
            this._boundResize = null;
        }
        
        if (this.scene) {
            this.scene.traverse((object) => {
                if (object.geometry) {
                    object.geometry.dispose();
                }
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(material => {
                            if (material.map) material.map.dispose();
                            material.dispose();
                        });
                    } else {
                        if (object.material.map) object.material.map.dispose();
                        object.material.dispose();
                    }
                }
            });
            while(this.scene.children.length > 0) {
                this.scene.remove(this.scene.children[0]);
            }
        }
        
        if (this.controls) {
            this.controls.dispose();
        }
        
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.forceContextLoss();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }
        
        if (this._listenersAbortController) {
            this._listenersAbortController.abort();
            this._listenersAbortController = null;
        }

        if (this._glitchTextureDebounceTimer) {
            clearTimeout(this._glitchTextureDebounceTimer);
            this._glitchTextureDebounceTimer = null;
        }

        if (this._manifestColorRefreshRaf != null) {
            cancelAnimationFrame(this._manifestColorRefreshRaf);
            this._manifestColorRefreshRaf = null;
        }
        this._manifestSkinTextureKey = null;
        this._manifestSharedColorUniforms = null;
        this._manifestSharedPresentationUniforms = null;

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.model = null;
        this.modelViewer = null;
        this.isInitialized = false;
        this.initRetries = 0;
        this.sunLight = null;
        this.ambientLight = null;
        this.hemisphereLight = null;
        this.groundMesh = null;
        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer = null;
        }
        this.clock = null;
        this.gltfAnimationClips = [];
        this._currentSkinManifest = null;
        this._gltfBaseMapSource = null;
        this._syncAnimationSelectorUI();
    },

    onWindowResize() {
        if (!this.modelViewer || !this.camera || !this.renderer) return;
        const w = this.modelViewer.clientWidth;
        const h = this.modelViewer.clientHeight;
        if (!w || !h) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(
            Math.min(window.devicePixelRatio || 1, SKIN_VIEWER_MAX_PIXEL_RATIO)
        );
        this.renderer.setSize(w, h);
    },

    toggleRotation() {
        if (!this.controls) return this.isRotating;
        this.isRotating = !this.isRotating;
        this.controls.autoRotate = this.isRotating;
        return this.isRotating;
    },

    animate() {
        if (!this.controls || !this.renderer || !this.scene || !this.camera) return;
        
        this.animationId = requestAnimationFrame(this.animate.bind(this));
        this.controls.update();
        if (this.mixer && this.clock) {
            this.mixer.update(this.clock.getDelta());
        }
        this.renderer.render(this.scene, this.camera);
    },

    _installLighting() {
        if (!this.scene || !this.renderer) return;

        this.renderer.shadowMap.enabled = false;
        this.renderer.shadowMap.autoUpdate = false;

        this.ambientLight = new THREE.AmbientLight(OASIS_SKIN_VIEWER_AMBIENT_COLOR, OASIS_SKIN_VIEWER_AMBIENT_INTENSITY);
        this.scene.add(this.ambientLight);

        this.hemisphereLight = new THREE.HemisphereLight(
            UE5_SKIN_VIEWER_HEMI_SKY,
            UE5_SKIN_VIEWER_HEMI_GROUND,
            UE5_SKIN_VIEWER_HEMI_INTENSITY
        );
        this.hemisphereLight.position.set(0, 1, 0);
        this.scene.add(this.hemisphereLight);

        this.sunLight = new THREE.DirectionalLight(
            OASIS_SKIN_VIEWER_KEY_COLOR,
            OASIS_SKIN_VIEWER_KEY_INTENSITY
        );
        this.sunLight.castShadow = false;
        this.sunLight.position.set(
            OASIS_SKIN_VIEWER_KEY_POSITION.x,
            OASIS_SKIN_VIEWER_KEY_POSITION.y,
            OASIS_SKIN_VIEWER_KEY_POSITION.z
        );
        this.scene.add(this.sunLight);

        this._applySkinViewerPresentationForMode();
    },

    _applySkinViewerPresentationForMode() {
        if (!this.renderer || !this.sunLight || !this.ambientLight) return;

        const glitch = this.isGlitchSkinMode();

        if (glitch) {
            if (THREE.NoToneMapping !== undefined) {
                this.renderer.toneMapping = THREE.NoToneMapping;
            }
            if (this.renderer.toneMappingExposure !== undefined) {
                this.renderer.toneMappingExposure = 1;
            }
            this.ambientLight.color.setHex(OASIS_SKIN_VIEWER_AMBIENT_COLOR);
            this.ambientLight.intensity = OASIS_SKIN_VIEWER_AMBIENT_INTENSITY;
            this.sunLight.color.setHex(OASIS_SKIN_VIEWER_KEY_COLOR);
            this.sunLight.intensity = OASIS_SKIN_VIEWER_KEY_INTENSITY;
            this.sunLight.position.set(
                OASIS_SKIN_VIEWER_KEY_POSITION.x,
                OASIS_SKIN_VIEWER_KEY_POSITION.y,
                OASIS_SKIN_VIEWER_KEY_POSITION.z
            );
            if (this.hemisphereLight) {
                this.hemisphereLight.visible = false;
                this.hemisphereLight.intensity = 0;
            }
            return;
        }

        if (THREE.ACESFilmicToneMapping !== undefined) {
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        } else if (THREE.ReinhardToneMapping !== undefined) {
            this.renderer.toneMapping = THREE.ReinhardToneMapping;
        }
        if (this.renderer.toneMappingExposure !== undefined) {
            this.renderer.toneMappingExposure = UE5_SKIN_TONE_MAPPING_EXPOSURE;
        }

        this.ambientLight.color.setHex(UE5_SKIN_VIEWER_AMBIENT_COLOR);
        this.ambientLight.intensity = UE5_SKIN_VIEWER_AMBIENT_INTENSITY;

        if (this.hemisphereLight) {
            this.hemisphereLight.visible = true;
            this.hemisphereLight.color.setHex(UE5_SKIN_VIEWER_HEMI_SKY);
            this.hemisphereLight.groundColor.setHex(UE5_SKIN_VIEWER_HEMI_GROUND);
            this.hemisphereLight.intensity = UE5_SKIN_VIEWER_HEMI_INTENSITY;
        }

        this.sunLight.color.setHex(UE5_SKIN_VIEWER_SUN_COLOR);
        this.sunLight.intensity = UE5_SKIN_VIEWER_SUN_INTENSITY;
        this.sunLight.position.set(
            UE5_SKIN_VIEWER_SUN_POSITION.x,
            UE5_SKIN_VIEWER_SUN_POSITION.y,
            UE5_SKIN_VIEWER_SUN_POSITION.z
        );
    },

    setSun(_azimuthDeg, _intensity) {},

    updateGroundPlane() {
        if (!this.scene) return;
        if (this.groundMesh) {
            this.scene.remove(this.groundMesh);
            if (this.groundMesh.geometry) this.groundMesh.geometry.dispose();
            if (this.groundMesh.material) this.groundMesh.material.dispose();
            this.groundMesh = null;
        }
    },

    _syncAnimationSelectorUI() {
        const wrap = document.getElementById('skinCreatorAnimationWrap');
        const sel = document.getElementById('skinCreatorAnimationSelect');
        if (!wrap || !sel) return;
        const clips = this.gltfAnimationClips || [];
        if (clips.length === 0) {
            wrap.style.display = 'none';
            sel.innerHTML = '';
            return;
        }
        wrap.style.display = 'flex';
        sel.innerHTML = '';
        clips.forEach((clip, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = labelForAnimationClip(clip, i);
            sel.appendChild(opt);
        });
        sel.value = '0';
    },

    setAnimationClipIndex(index) {
        if (!this.mixer || !this.gltfAnimationClips.length) return;
        const n = this.gltfAnimationClips.length;
        const i = Math.max(0, Math.min(Number(index) || 0, n - 1));
        this.mixer.stopAllAction();
        const action = this.mixer.clipAction(this.gltfAnimationClips[i]);
        action.reset();
        action.play();
    },

    _applyLoadedModel(object, animations) {
        if (!this.scene) return;

        if (this.model && this.scene) {
            this.scene.remove(this.model);
            disposeThreeObjectTree(this.model);
            this.model = null;
        }

        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer = null;
        }

        this.model = object;
        this.gltfAnimationClips =
            animations && animations.length
                ? sortClipsByKnownAnimationOrder(animations.slice())
                : [];

        if (this.gltfAnimationClips.length > 0) {
            this.mixer = new THREE.AnimationMixer(this.model);
            this.setAnimationClipIndex(0);
        }

        this.model.scale.set(0.005, 0.005, 0.005);
        this.scene.add(this.model);

        this.model.updateMatrixWorld(true);
        const box0 = new THREE.Box3().setFromObject(this.model);
        const center = new THREE.Vector3();
        box0.getCenter(center);
        this.model.position.sub(center);

        this.model.rotation.y = Math.PI / 4;
        this.model.updateMatrixWorld(true);

        const fitBox = new THREE.Box3().setFromObject(this.model);
        const size = fitBox.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
        const sphere = fitBox.getBoundingSphere(new THREE.Sphere());
        const radius = Math.max(sphere.radius, maxDim * 0.5, 1e-6);

        const margin = 1.28;
        const vFovRad = THREE.Math.degToRad(this.camera.fov);
        const fitDist = (maxDim * margin) / (2 * Math.tan(vFovRad / 2));
        const dist = Math.min(Math.max(fitDist, radius * 1.15), radius * 18);

        this.camera.near = Math.max(0.001, radius * 0.003);
        this.camera.far = Math.max(500, radius * 400);
        this.camera.updateProjectionMatrix();

        this.camera.position.set(dist * 0.62, dist * 0.38, dist * 0.92);
        if (this.controls) {
            this.controls.target.set(0, 0, 0);
            this.controls.minDistance = Math.max(radius * 0.08, this.camera.near * 3);
            this.controls.maxDistance = Math.max(radius * 40, dist * 4, 8);
            this.controls.update();
        } else {
            this.camera.lookAt(0, 0, 0);
        }

        this.updateGroundPlane();

        this._gltfBaseMapSource = null;
        this.model.traverse((ch) => {
            if (this._gltfBaseMapSource || !(ch instanceof THREE.Mesh)) return;
            const mats = ch.material;
            const m = Array.isArray(mats) ? mats[0] : mats;
            if (m && m.map) this._gltfBaseMapSource = m.map;
        });

        this.updateModelColors();
        this._syncAnimationSelectorUI();
    },

    loadModel(modelName) {
        if (!this.scene) {
            if (!this.isInitialized) {
                this.init();
            }
            return;
        }

        if (this.model) {
            this.scene.remove(this.model);
            if (this.mixer) {
                this.mixer.stopAllAction();
                this.mixer = null;
            }
            this.model.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach((m) => disposeSingleMaterial(m));
                    } else {
                        disposeSingleMaterial(child.material);
                    }
                }
            });
            this.model = null;
        }

        if (this.groundMesh && this.scene) {
            this.scene.remove(this.groundMesh);
            if (this.groundMesh.geometry) this.groundMesh.geometry.dispose();
            if (this.groundMesh.material) this.groundMesh.material.dispose();
            this.groundMesh = null;
        }

        this.gltfAnimationClips = [];
        this._syncAnimationSelectorUI();

        this._modelLoadToken = (this._modelLoadToken || 0) + 1;
        const expectedToken = this._modelLoadToken;
        this._currentSkinManifest = null;
        this._manifestSkinTextureKey = null;
        this._gltfBaseMapSource = null;

        const manifestUrl = `models/${modelName}/${modelName}.json`;
        const objPath = `models/${modelName}/${modelName}.obj`;
        const preferGlb = !!THREE.GLTFLoader;
        const defaultGlbPath = `models/${modelName}/${modelName}.glb`;

        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'flex';
            loadingOverlay.innerHTML = '<div class="loading-spinner"></div><div>Loading 3D Model...</div>';
        }

        const loadTimeout = setTimeout(() => {
            if (loadingOverlay && loadingOverlay.style.display === 'flex') {
                loadingOverlay.innerHTML = '<div class="loading-spinner"></div><div>Still loading... Please wait</div>';
            }
        }, 5000);

        const onProgress = (xhr) => {
            if (xhr.total > 0) {
                const percent = Math.round(xhr.loaded / xhr.total * 100);
                if (loadingOverlay) {
                    loadingOverlay.innerHTML = `<div class="loading-spinner"></div><div>Loading 3D Model... ${percent}%</div>`;
                }
            }
        };

        const onLoadFailed = (path, error) => {
            clearTimeout(loadTimeout);
            console.error('Error loading model:', path, error);
            if (loadingOverlay) {
                loadingOverlay.innerHTML = '<div style="color: #ff6b6b;">Failed to load model. Please refresh the page.</div>';
                setTimeout(() => {
                    if (loadingOverlay) loadingOverlay.style.display = 'none';
                }, 3000);
            }
        };

        const finish = (rootObject, animations) => {
            clearTimeout(loadTimeout);
            if (!this.scene || this._modelLoadToken !== expectedToken) {
                if (loadingOverlay) loadingOverlay.style.display = 'none';
                disposeThreeObjectTree(rootObject);
                return;
            }
            if (loadingOverlay) loadingOverlay.style.display = 'none';
            if (this.renderer) {
                this._upgradeModelTextures(rootObject);
            }
            this._applyLoadedModel(rootObject, animations);
        };

        const loadObj = () => {
            const loader = new THREE.OBJLoader();
            loader.load(
                objPath,
                (object) => {
                    finish(object, null);
                },
                onProgress,
                (error) => onLoadFailed(objPath, error)
            );
        };

        const tryLoadGltf = (glbPath) => {
            if (!preferGlb) {
                loadObj();
                return;
            }
            const gltfLoader = new THREE.GLTFLoader();
            gltfLoader.load(
                glbPath,
                (gltf) => {
                    finish(gltf.scene, gltf.animations || []);
                },
                onProgress,
                (error) => {
                    console.warn('GLB load failed, falling back to OBJ:', glbPath, error);
                    loadObj();
                }
            );
        };

        fetch(manifestUrl)
            .then((res) => (res.ok ? res.json() : null))
            .then((manifest) => {
                if (!this.scene || this._modelLoadToken !== expectedToken) return;
                if (manifest && typeof manifest === 'object') {
                    this._currentSkinManifest = manifest;
                }
                const file =
                    manifest && typeof manifest.Model === 'string' && manifest.Model.trim()
                        ? manifest.Model.trim()
                        : `${modelName}.glb`;
                tryLoadGltf(`models/${modelName}/${file}`);
            })
            .catch(() => {
                if (!this.scene || this._modelLoadToken !== expectedToken) return;
                this._currentSkinManifest = null;
                tryLoadGltf(defaultGlbPath);
            });
    },

    scheduleUpdateModelColors(immediate) {
        const run = () => {
            if (this._glitchTextureDebounceTimer) {
                clearTimeout(this._glitchTextureDebounceTimer);
                this._glitchTextureDebounceTimer = null;
            }
            if (this.isGlitchSkinMode()) {
                this.syncGlitchFloatsToHexPickers();
            }
            this.updateModelColors();
        };
        if (immediate) {
            run();
            return;
        }
        if (this._glitchTextureDebounceTimer) {
            clearTimeout(this._glitchTextureDebounceTimer);
        }
        this._glitchTextureDebounceTimer = setTimeout(run, 220);
    },

    syncHexPickerToGlitchFloats(inputId) {
        const hexEl = document.getElementById(inputId);
        if (!hexEl) return;
        const rgb = this.hexToRgb(hexEl.value);
        if (!rgb) return;
        const axes = ['r', 'g', 'b'];
        const vals = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
        axes.forEach((axis, i) => {
            const el = document.getElementById(`${inputId}-${axis}`);
            if (el) el.value = String(vals[i]);
        });
    },

    updateModelColors() {
        if (!this.model) return;
        this._applySkinViewerPresentationForMode();
        const manifest = this._currentSkinManifest;
        const hasManifest =
            manifest &&
            manifest.BodyMaterial &&
            manifest.BodyMaterial.Textures &&
            manifest.BodyMaterial.Textures.BaseMask;
        if (hasManifest) {
            this._updateModelColorsFromManifest();
            return;
        }
        this.updateModelColorsLegacy();
    },

    _ensureWhiteFallbackMap() {
        if (this._whiteFallbackMap) return this._whiteFallbackMap;
        const d = new Uint8Array([255, 255, 255, 255]);
        const t = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
        t.needsUpdate = true;
        if (THREE.LinearEncoding !== undefined) {
            t.encoding = THREE.LinearEncoding;
        }
        this._whiteFallbackMap = t;
        return t;
    },

    _skinViewerMaxAnisotropy() {
        const r = this.renderer;
        if (!r || !r.capabilities || typeof r.capabilities.getMaxAnisotropy !== 'function') {
            return 1;
        }
        return Math.min(SKIN_VIEWER_TEXTURE_ANISOTROPY_CAP, r.capabilities.getMaxAnisotropy());
    },

    _upgradeTextureQuality(tex) {
        if (!tex || !this.renderer) return;
        const maxA = this._skinViewerMaxAnisotropy();
        if (typeof tex.anisotropy === 'number' && maxA > 1) {
            tex.anisotropy = maxA;
        }
        const img = tex.image;
        const w = img && img.width;
        const h = img && img.height;
        const sizable = typeof w === 'number' && typeof h === 'number' && (w > 1 || h > 1);
        if (sizable) {
            if (THREE.LinearFilter !== undefined) {
                tex.magFilter = THREE.LinearFilter;
            }
            if (THREE.LinearMipMapLinearFilter !== undefined) {
                tex.minFilter = THREE.LinearMipMapLinearFilter;
                tex.generateMipmaps = true;
            }
        }
        tex.needsUpdate = true;
    },

    _upgradeMaterialTextures(mat) {
        if (!mat) return;
        [
            'map',
            'normalMap',
            'roughnessMap',
            'metalnessMap',
            'aoMap',
            'emissiveMap',
            'bumpMap',
            'lightMap',
            'displacementMap'
        ].forEach((k) => {
            if (mat[k]) this._upgradeTextureQuality(mat[k]);
        });
    },

    _upgradeModelTextures(root) {
        if (!root) return;
        root.traverse((obj) => {
            if (!obj.material) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => this._upgradeMaterialTextures(m));
        });
    },

    _skinMeshUniform(inputId) {
        const rgb = this.getSkinColorRgb(inputId);
        if (this.isGlitchSkinMode()) {
            return skinRgbToOasisVec3(rgb.r, rgb.g, rgb.b);
        }
        const el = document.getElementById(inputId);
        const hex = el && el.value ? el.value : '#000000';
        const c = new THREE.Color(hex);
        return new THREE.Vector3(
            skinSrgbChannelToLinear(c.r),
            skinSrgbChannelToLinear(c.g),
            skinSrgbChannelToLinear(c.b)
        );
    },

    _skinVec3UniformLikeOasis(inputId) {
        const rgb = this.getSkinColorRgb(inputId);
        if (this.isGlitchSkinMode()) {
            return skinRgbToOasisVec3(rgb.r, rgb.g, rgb.b);
        }
        return new THREE.Vector3(rgb.r / 255, rgb.g / 255, rgb.b / 255);
    },

    _ensureManifestSharedColorUniforms() {
        if (this._manifestSharedColorUniforms) return this._manifestSharedColorUniforms;
        this._manifestSharedColorUniforms = {
            uTeethColor: new THREE.Vector3(1, 1, 1),
            uMouthColor: new THREE.Vector3(1, 1, 1),
            uClawColor: new THREE.Vector3(1, 1, 1),
            uColMaleDisplay: new THREE.Vector3(),
            uColUnderbelly: new THREE.Vector3(),
            uColFlank: new THREE.Vector3(),
            uColBody: new THREE.Vector3(),
            uColMarkings: new THREE.Vector3(),
            uColDetail: new THREE.Vector3()
        };
        return this._manifestSharedColorUniforms;
    },

    _ensureManifestSharedPresentationUniforms() {
        if (this._manifestSharedPresentationUniforms) return this._manifestSharedPresentationUniforms;
        this._manifestSharedPresentationUniforms = {
            uSkinPatternNeutralGray: { value: SKIN_GLITCH_PATTERN_NEUTRAL_GRAY },
            uSkinManifestDiffuseGain: { value: SKIN_GLITCH_MANIFEST_DIFFUSE_GAIN },
            uSkinPreviewSaturation: { value: SKIN_GLITCH_PREVIEW_SATURATION }
        };
        return this._manifestSharedPresentationUniforms;
    },

    _syncManifestPresentationUniformsFromMode() {
        const u = this._manifestSharedPresentationUniforms;
        if (!u) return;
        if (this.isGlitchSkinMode()) {
            u.uSkinPatternNeutralGray.value = SKIN_GLITCH_PATTERN_NEUTRAL_GRAY;
            u.uSkinManifestDiffuseGain.value = SKIN_GLITCH_MANIFEST_DIFFUSE_GAIN;
            u.uSkinPreviewSaturation.value = SKIN_GLITCH_PREVIEW_SATURATION;
        } else {
            u.uSkinPatternNeutralGray.value = SKIN_NORMAL_PATTERN_NEUTRAL_GRAY;
            u.uSkinManifestDiffuseGain.value = SKIN_NORMAL_MANIFEST_DIFFUSE_GAIN;
            u.uSkinPreviewSaturation.value = SKIN_NORMAL_PREVIEW_SATURATION;
        }
    },

    _refreshManifestSkinColorsFromDom() {
        const manifest = this._currentSkinManifest;
        const shared = this._manifestSharedColorUniforms;
        if (!manifest || !shared) return;
        shared.uTeethColor.copy(manifestLinearColorVec3(manifest, 'TeethColor', [1, 1, 1]));
        shared.uMouthColor.copy(manifestLinearColorVec3(manifest, 'MouthColor', [1, 1, 1]));
        shared.uClawColor.copy(manifestLinearColorVec3(manifest, 'ClawColor', [1, 1, 1]));
        shared.uColMaleDisplay.copy(this._skinVec3UniformLikeOasis('maleDisplayColor'));
        shared.uColUnderbelly.copy(this._skinVec3UniformLikeOasis('underbellyColor'));
        shared.uColFlank.copy(this._skinVec3UniformLikeOasis('flankColor'));
        shared.uColBody.copy(this._skinVec3UniformLikeOasis('bodyColor'));
        shared.uColMarkings.copy(this._skinVec3UniformLikeOasis('markingsColor'));
        shared.uColDetail.copy(this._skinVec3UniformLikeOasis('detail1Color'));
        this._syncManifestPresentationUniformsFromMode();
    },

    _scheduleManifestColorPreviewRefresh() {
        if (this._manifestColorRefreshRaf != null) return;
        this._manifestColorRefreshRaf = requestAnimationFrame(() => {
            this._manifestColorRefreshRaf = null;
            if (!this.model || !this._currentSkinManifest) return;
            if (!this._manifestSharedColorUniforms || !this._manifestSkinTextureKey) {
                this._updateModelColorsFromManifest();
                return;
            }
            const ck = this._computeManifestSkinTextureCacheKey();
            if (!ck || ck !== this._manifestSkinTextureKey) {
                this._updateModelColorsFromManifest();
                return;
            }
            this._refreshManifestSkinColorsFromDom();
            this.syncColorPreviewDots();
            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }
        });
    },

    _computeManifestSkinTextureCacheKey() {
        const manifest = this._currentSkinManifest;
        if (!manifest || !manifest.BodyMaterial || !manifest.BodyMaterial.Textures) return null;
        const dinoName = document.getElementById('modelSelect') ? document.getElementById('modelSelect').value : '';
        const patternIndex = document.getElementById('pattern') ? document.getElementById('pattern').value : '0';
        const ageStageEl = document.getElementById('age-stage');
        const ageStage = ageStageEl ? ageStageEl.value : 'Adult';
        const texRoot = manifest.BodyMaterial.Textures;
        const patternRel = resolvePatternEntryFromManifest(manifest, ageStage, patternIndex);
        const baseMaskRel = texRoot.BaseMask;
        const albedoRel = texRoot.AlbedoMap || '';
        if (!patternRel || !baseMaskRel) return null;
        const msk = this.isGlitchSkinMode() ? 'g' : 'n';
        return `${dinoName}|${patternIndex}|${ageStage}|${baseMaskRel}|${patternRel}|${albedoRel}|${msk}`;
    },

    _prepareSkinIdMaskTexture(tex) {
        if (!tex) return;
        tex.generateMipmaps = false;
        tex.anisotropy = 1;
        if (THREE.NearestFilter !== undefined) {
            tex.minFilter = THREE.NearestFilter;
            tex.magFilter = THREE.NearestFilter;
        }
        tex.needsUpdate = true;
    },

    _cloneTextureLikeMap(sourceTex, refMap, skinnedMesh) {
        const t = sourceTex.clone();
        t.needsUpdate = true;
        if (refMap) {
            t.offset.copy(refMap.offset);
            t.repeat.copy(refMap.repeat);
            t.rotation = refMap.rotation;
            t.center.copy(refMap.center);
            t.wrapS = refMap.wrapS;
            t.wrapT = refMap.wrapT;
            if (typeof refMap.flipY === 'boolean') {
                t.flipY = refMap.flipY;
            }
        } else {
            t.flipY = !skinnedMesh;
        }
        if (THREE.LinearEncoding !== undefined) {
            t.encoding = THREE.LinearEncoding;
        }
        if (THREE.LinearFilter !== undefined) {
            t.magFilter = THREE.LinearFilter;
        }
        if (THREE.LinearMipMapLinearFilter !== undefined) {
            t.minFilter = THREE.LinearMipMapLinearFilter;
            t.generateMipmaps = true;
        }
        if (this.renderer) {
            this._upgradeTextureQuality(t);
        }
        return t;
    },

    _updateModelColorsFromManifest() {
        const dinoName = document.getElementById('modelSelect').value;
        const patternIndex = document.getElementById('pattern').value;
        const ageStageEl = document.getElementById('age-stage');
        const ageStage = ageStageEl ? ageStageEl.value : 'Adult';
        const manifest = this._currentSkinManifest;
        if (!manifest || !manifest.BodyMaterial || !manifest.BodyMaterial.Textures) {
            this.updateModelColorsLegacy();
            return;
        }

        if (patternIndex === "0") {
            this.updateModelColorsLegacy();
            return;
        }

        const base = `models/${dinoName}/`;
        const texRoot = manifest.BodyMaterial.Textures;
        const patternRel = resolvePatternEntryFromManifest(manifest, ageStage, patternIndex);
        const baseMaskRel = texRoot.BaseMask;
        if (!patternRel || !baseMaskRel) {
            this.updateModelColorsLegacy();
            return;
        }
        const albedoRel = texRoot.AlbedoMap || '';
        const cacheKey = this._computeManifestSkinTextureCacheKey();
        if (!cacheKey) {
            this.updateModelColorsLegacy();
            return;
        }

        if (this._manifestSkinTextureKey === cacheKey && this._manifestSharedColorUniforms && this.model) {
            this._refreshManifestSkinColorsFromDom();
            this.syncColorPreviewDots();
            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }
            return;
        }

        this._updateColorsToken = (this._updateColorsToken || 0) + 1;
        const token = this._updateColorsToken;
        const textureLoader = new THREE.TextureLoader();
        const loadTex = (rel) =>
            new Promise((resolve, reject) => {
                textureLoader.load(
                    base + rel,
                    (tex) => resolve(tex),
                    undefined,
                    (err) => reject(err)
                );
            });

        Promise.all([
            loadTex(baseMaskRel),
            loadTex(patternRel),
            albedoRel ? loadTex(albedoRel) : Promise.resolve(null)
        ])
            .then(([baseTex, patternTex, albedoTex]) => {
                if (!this.model || token !== this._updateColorsToken) {
                    baseTex.dispose();
                    patternTex.dispose();
                    if (albedoTex) albedoTex.dispose();
                    return;
                }
                this._upgradeTextureQuality(baseTex);
                this._upgradeTextureQuality(patternTex);
                if (albedoTex) this._upgradeTextureQuality(albedoTex);
                const white = this._ensureWhiteFallbackMap();
                const albedoSrc = albedoTex || white;
                const glbMap = this._gltfBaseMapSource;

                const shared = this._ensureManifestSharedColorUniforms();
                this._ensureManifestSharedPresentationUniforms();
                this._refreshManifestSkinColorsFromDom();

                const isSkinnedMesh = (child) => child instanceof THREE.SkinnedMesh;

                const buildMat = (oldMat, child) => {
                    const skinned = isSkinnedMesh(child);
                    const refMap = oldMat && oldMat.map;
                    const normalMap = oldMat && oldMat.normalMap;
                    const normalScale = oldMat && oldMat.normalScale;
                    const metalness = 0;
                    const roughness = Math.max(
                        oldMat && typeof oldMat.roughness === 'number' ? oldMat.roughness : 0.82,
                        0.98
                    );
                    const morphNormals = oldMat && oldMat.morphNormals === true;
                    const useMorph = child.morphTargetInfluences && child.morphTargetInfluences.length > 0;
                    if (oldMat) {
                        oldMat.map = null;
                        oldMat.normalMap = null;
                        disposeSingleMaterial(oldMat);
                    }

                    const uvRef = glbMap || refMap;
                    const bm = this._cloneTextureLikeMap(baseTex, uvRef, skinned);
                    const pm = this._cloneTextureLikeMap(patternTex, uvRef, skinned);
                    if (!this.isGlitchSkinMode()) {
                        this._prepareSkinIdMaskTexture(bm);
                        this._prepareSkinIdMaskTexture(pm);
                    }
                    const am = this._cloneTextureLikeMap(albedoSrc, uvRef, skinned);
                    const om = glbMap
                        ? this._cloneTextureLikeMap(glbMap, uvRef, skinned)
                        : this._cloneTextureLikeMap(white, uvRef, skinned);

                    const mat = new THREE.MeshStandardMaterial({
                        map: white,
                        metalness,
                        roughness,
                        envMapIntensity: 0,
                        skinning: skinned,
                        morphTargets: useMorph,
                        morphNormals: useMorph && morphNormals,
                        transparent: true
                    });
                    if (normalMap) {
                        mat.normalMap = normalMap;
                        if (normalScale) {
                            mat.normalScale.copy(normalScale);
                        }
                        this._upgradeTextureQuality(normalMap);
                    }

                    const pres = this._ensureManifestSharedPresentationUniforms();

                    const uniformsSkin = {
                        uSkinBaseMask: { value: bm },
                        uSkinPattern: { value: pm },
                        uSkinAlbedo: { value: am },
                        uSkinOrigMap: { value: om },
                        uTeethColor: { value: shared.uTeethColor },
                        uMouthColor: { value: shared.uMouthColor },
                        uClawColor: { value: shared.uClawColor },
                        uColMaleDisplay: { value: shared.uColMaleDisplay },
                        uColUnderbelly: { value: shared.uColUnderbelly },
                        uColFlank: { value: shared.uColFlank },
                        uColBody: { value: shared.uColBody },
                        uColMarkings: { value: shared.uColMarkings },
                        uColDetail: { value: shared.uColDetail },
                        uSkinPatternNeutralGray: pres.uSkinPatternNeutralGray,
                        uSkinManifestDiffuseGain: pres.uSkinManifestDiffuseGain,
                        uSkinPreviewSaturation: pres.uSkinPreviewSaturation
                    };

                    mat.onBeforeCompile = (shader) => {
                        shader.uniforms.uSkinBaseMask = uniformsSkin.uSkinBaseMask;
                        shader.uniforms.uSkinPattern = uniformsSkin.uSkinPattern;
                        shader.uniforms.uSkinAlbedo = uniformsSkin.uSkinAlbedo;
                        shader.uniforms.uSkinOrigMap = uniformsSkin.uSkinOrigMap;
                        shader.uniforms.uTeethColor = uniformsSkin.uTeethColor;
                        shader.uniforms.uMouthColor = uniformsSkin.uMouthColor;
                        shader.uniforms.uClawColor = uniformsSkin.uClawColor;
                        shader.uniforms.uColMaleDisplay = uniformsSkin.uColMaleDisplay;
                        shader.uniforms.uColUnderbelly = uniformsSkin.uColUnderbelly;
                        shader.uniforms.uColFlank = uniformsSkin.uColFlank;
                        shader.uniforms.uColBody = uniformsSkin.uColBody;
                        shader.uniforms.uColMarkings = uniformsSkin.uColMarkings;
                        shader.uniforms.uColDetail = uniformsSkin.uColDetail;
                        shader.uniforms.uSkinPatternNeutralGray = uniformsSkin.uSkinPatternNeutralGray;
                        shader.uniforms.uSkinManifestDiffuseGain = uniformsSkin.uSkinManifestDiffuseGain;
                        shader.uniforms.uSkinPreviewSaturation = uniformsSkin.uSkinPreviewSaturation;
                        shader.fragmentShader = SKIN_SHADER_PREAMBLE + shader.fragmentShader;
                        shader.fragmentShader = shader.fragmentShader.replace(
                            '#include <map_fragment>',
                            SKIN_MAP_FRAGMENT_REPLACE
                        );
                    };

                    mat.needsUpdate = true;
                    return mat;
                };

                this.model.traverse((child) => {
                    if (!(child instanceof THREE.Mesh)) return;
                    const old = child.material;
                    if (Array.isArray(old)) {
                        child.material = old.map((m) => buildMat(m, child));
                    } else {
                        child.material = buildMat(old, child);
                    }
                    child.castShadow = false;
                    child.receiveShadow = false;
                });

                baseTex.dispose();
                patternTex.dispose();
                if (albedoTex) albedoTex.dispose();

                this._manifestSkinTextureKey = cacheKey;

                if (this.renderer && this.scene && this.camera) {
                    this.renderer.render(this.scene, this.camera);
                }
                this.syncColorPreviewDots();
            })
            .catch((err) => {
                console.warn('Manifest skin texture load failed, using legacy path:', err);
                if (token === this._updateColorsToken) {
                    this.updateModelColorsLegacy();
                }
            });
    },

    updateModelColorsLegacy() {
        if (!this.model) return;

        const patternIndex = document.getElementById('pattern').value;
        const dinoName = document.getElementById('modelSelect').value;
        const textureLoader = new THREE.TextureLoader();
        const ageStageEl = document.getElementById('age-stage');
        const ageStage = ageStageEl ? ageStageEl.value : 'Adult';
        
        const filePatternNum = parseInt(patternIndex, 10) + 1;

        const texturePath = ageStage === 'Adult'
            ? `models/${dinoName}/T_${dinoName}_Adult_Pattern_${filePatternNum}.png`
            : `models/${dinoName}/T_${dinoName}_${ageStage}_Pattern.png`;
        
        console.log('Loading texture from:', texturePath);

        textureLoader.load(
            texturePath,
            (texture) => {
                console.log('Texture loaded successfully');
            
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = texture.image;
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            const colorMapping = {
                "maleDisplay": { color: [255, 0, 0], tolerance: 10 },      
                "markings": { color: [255, 0, 255], tolerance: 10 },       
                "flank": { color: [0, 0, 255], tolerance: 10 },            
                "body": { color: [0, 255, 255], tolerance: 30 },          
                "underbelly": { color: [0, 255, 0], tolerance: 10 },       
                "detail1": { color: [128, 0, 128], tolerance: 10 },        
                "eyes": { color: [255, 255, 0], tolerance: 10 }            
            };

            this.debugInfo = {
                imageSize: { width: canvas.width, height: canvas.height },
                colorMapping: colorMapping,
                selectedColors: {},
                pixelCounts: {},
                matchedPixels: {}
            };
            
            const colorsMatch = (r1, g1, b1, [r2, g2, b2], tolerance, part) => {
                const dr = Math.abs(r1 - r2);
                const dg = Math.abs(g1 - g2);
                const db = Math.abs(b1 - b2);
                
                if (part === 'body') {
                    const matches = dr <= tolerance && dg <= tolerance && db <= tolerance;
                    if (matches) {
                        return g1 > r1 + 5 && b1 > r1 + 5;
                    }
                    return false;
                }

                const allBlack = Object.entries(this.debugInfo.selectedColors).every(([_, color]) => 
                    color.rgb.r === 0 && color.rgb.g === 0 && color.rgb.b === 0
                );

                if (allBlack) {
                    switch(part) {
                        case 'markings':
                            return r1 > g1 + 50 && b1 > g1 + 50;
                        case 'flank':
                            return b1 > r1 + 50 && b1 > g1 + 50;
                        case 'body':
                            return g1 > r1 + 50 && b1 > r1 + 50;
                        case 'underbelly':
                            return g1 > r1 + 50 && g1 > b1 + 50;
                        case 'maleDisplay':
                            return r1 > g1 + 50 && r1 > b1 + 50;
                        case 'detail1':
                            return Math.abs(r1 - b1) < 20 && r1 > g1 + 30;
                        case 'eyes':
                            return r1 > b1 + 50 && g1 > b1 + 50;
                        default:
                            return false;
                    }
                }

                const matches = dr <= tolerance && dg <= tolerance && db <= tolerance;
                if (!matches) return false;

                for (const [otherPart, { color }] of Object.entries(colorMapping)) {
                    if (otherPart !== part) {
                        const [or, og, ob] = color;
                        const otherDr = Math.abs(r1 - or);
                        const otherDg = Math.abs(g1 - og);
                        const otherDb = Math.abs(b1 - ob);
                        const otherTotalDiff = otherDr + otherDg + otherDb;
                        const currentTotalDiff = dr + dg + db;
                        
                        if (otherTotalDiff < currentTotalDiff) {
                            return false;
                        }
                    }
                }
                
                return true;
            };

            const masks = {};
            const pixelCounts = {};
            for (const part in colorMapping) {
                masks[part] = new Uint8Array(data.length / 4);
                pixelCounts[part] = 0;
            }

            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const pixelIndex = i / 4;

                let bestPart = null;
                let bestDiff = Infinity;

                for (const [part, { color, tolerance }] of Object.entries(colorMapping)) {
                    if (colorsMatch(r, g, b, color, tolerance, part)) {
                        const [cr, cg, cb] = color;
                        const diff = Math.abs(r - cr) + Math.abs(g - cg) + Math.abs(b - cb);
                        if (diff < bestDiff) {
                            bestDiff = diff;
                            bestPart = part;
                        }
                    }
                }

                if (bestPart) {
                    masks[bestPart][pixelIndex] = 1;
                    pixelCounts[bestPart]++;
                }
            }

            this.debugInfo.pixelCounts = pixelCounts;
            
            for (const [part, mask] of Object.entries(masks)) {
                const picker = document.getElementById(part + 'Color');
                if (picker) {
                    const newColor = this.getSkinColorPreviewBytes(part + 'Color');
                    if (newColor) {
                        this.debugInfo.selectedColors[part] = {
                            hex: picker.value,
                            rgb: newColor,
                            glitch: this.isGlitchSkinMode()
                        };

                        for (let i = 0; i < mask.length; i++) {
                            if (mask[i]) {
                                const pixelIndex = i * 4;
                                data[pixelIndex] = newColor.r;
                                data[pixelIndex + 1] = newColor.g;
                                data[pixelIndex + 2] = newColor.b;
                                data[pixelIndex + 3] = 255; 
                            }
                        }
                    }
                }
            }


            const coloredPixels = new Uint8Array(data.length / 4);
            for (const mask of Object.values(masks)) {
                for (let i = 0; i < mask.length; i++) {
                    if (mask[i]) coloredPixels[i] = 1;
                }
            }

            const underbellyPicker = document.getElementById('underbellyColor');
            const flankPicker = document.getElementById('flankColor');
            const bodyPicker = document.getElementById('bodyColor');
            const underbellyColor = underbellyPicker ? this.getSkinColorPreviewBytes('underbellyColor') : null;
            const flankColor = flankPicker ? this.getSkinColorPreviewBytes('flankColor') : null;
            const bodyColor = bodyPicker ? this.getSkinColorPreviewBytes('bodyColor') : null;

            for (let i = 0; i < data.length; i += 4) {
                const pixelIndex = i / 4;

                if (coloredPixels[pixelIndex]) continue;

                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];

                if (underbellyColor && g > r + 20 && g > b + 20 && g > 100) {
                    data[i] = underbellyColor.r;
                    data[i + 1] = underbellyColor.g;
                    data[i + 2] = underbellyColor.b;
                }
                else if (flankColor && b > r + 20 && b > g + 20 && b > 100) {
                    data[i] = flankColor.r;
                    data[i + 1] = flankColor.g;
                    data[i + 2] = flankColor.b;
                }
                else if (bodyColor && g > r + 20 && b > r + 20 && Math.abs(g - b) < 50) {
                    data[i] = bodyColor.r;
                    data[i + 1] = bodyColor.g;
                    data[i + 2] = bodyColor.b;
                }
            }
            
            ctx.putImageData(imageData, 0, 0);

            const baseTextureTemplate = new THREE.Texture(canvas);
            baseTextureTemplate.needsUpdate = true;
            if (THREE.sRGBEncoding !== undefined) {
                baseTextureTemplate.encoding = THREE.sRGBEncoding;
            }
            this._upgradeTextureQuality(baseTextureTemplate);

            const applyPatternMaterial = (child, oldMat) => {
                const skinned = child instanceof THREE.SkinnedMesh;
                const useMorph = child.morphTargetInfluences && child.morphTargetInfluences.length > 0;
                const map = baseTextureTemplate.clone();
                map.needsUpdate = true;
                map.flipY = !skinned;
                const prevMap = oldMat && oldMat.map;
                if (prevMap) {
                    map.offset.copy(prevMap.offset);
                    map.repeat.copy(prevMap.repeat);
                    map.rotation = prevMap.rotation;
                    map.center.copy(prevMap.center);
                    map.wrapS = prevMap.wrapS;
                    map.wrapT = prevMap.wrapT;
                    if (typeof prevMap.flipY === 'boolean') {
                        map.flipY = prevMap.flipY;
                    }
                }
                const mat = new THREE.MeshStandardMaterial({
                    map,
                    metalness: oldMat && typeof oldMat.metalness === 'number' ? oldMat.metalness : 0,
                    roughness: Math.max(
                        oldMat && typeof oldMat.roughness === 'number' ? oldMat.roughness : 0.82,
                        0.92
                    ),
                    envMapIntensity: 0,
                    skinning: skinned,
                    morphTargets: useMorph,
                    morphNormals: useMorph && oldMat && oldMat.morphNormals === true
                });
                if (oldMat && oldMat.normalMap) {
                    mat.normalMap = oldMat.normalMap;
                    if (oldMat.normalScale) {
                        mat.normalScale.copy(oldMat.normalScale);
                    }
                    this._upgradeTextureQuality(oldMat.normalMap);
                }
                mat.needsUpdate = true;
                child.material = mat;
                child.castShadow = false;
                child.receiveShadow = false;
            };

            this.model.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) return;
                const old = child.material;
                if (Array.isArray(old)) {
                    child.material = old.map((m) => {
                        const skinned = child instanceof THREE.SkinnedMesh;
                        const useMorph = child.morphTargetInfluences && child.morphTargetInfluences.length > 0;
                        const map = baseTextureTemplate.clone();
                        map.needsUpdate = true;
                        map.flipY = !skinned;
                        const prevMap = m && m.map;
                        if (prevMap) {
                            map.offset.copy(prevMap.offset);
                            map.repeat.copy(prevMap.repeat);
                            map.rotation = prevMap.rotation;
                            map.center.copy(prevMap.center);
                            map.wrapS = prevMap.wrapS;
                            map.wrapT = prevMap.wrapT;
                            if (typeof prevMap.flipY === 'boolean') {
                                map.flipY = prevMap.flipY;
                            }
                        }
                        const mat = new THREE.MeshStandardMaterial({
                            map,
                            metalness: m && typeof m.metalness === 'number' ? m.metalness : 0,
                            roughness: Math.max(
                                m && typeof m.roughness === 'number' ? m.roughness : 0.82,
                                0.92
                            ),
                            envMapIntensity: 0,
                            skinning: skinned,
                            morphTargets: useMorph,
                            morphNormals: useMorph && m && m.morphNormals === true
                        });
                        if (m && m.normalMap) {
                            mat.normalMap = m.normalMap;
                            if (m.normalScale) {
                                mat.normalScale.copy(m.normalScale);
                            }
                            this._upgradeTextureQuality(m.normalMap);
                        }
                        mat.needsUpdate = true;
                        return mat;
                    });
                    child.castShadow = false;
                    child.receiveShadow = false;
                } else {
                    applyPatternMaterial(child, old);
                }
            });
            
            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }

            this.syncColorPreviewDots();
        },
        undefined,
        (error) => {
            console.error('Failed to load texture:', texturePath);
            console.error('Error details:', error);

            const errorMsg = `Could not load pattern ${patternIndex} for ${dinoName}. The texture file may be missing.`;
            console.warn(errorMsg);

            if (this.showModal) {
                this.showModal('Texture Load Error', errorMsg);
            }
        });
    },

    debugColors() {
        if (!this.model) return;

        this.model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                const skinned = child instanceof THREE.SkinnedMesh;
                const useMorph = child.morphTargetInfluences && child.morphTargetInfluences.length > 0;
                child.material = new THREE.MeshStandardMaterial({
                    color: 0x000000,
                    metalness: 0,
                    roughness: 1,
                    skinning: skinned,
                    morphTargets: useMorph
                });
                child.material.needsUpdate = true;
                child.castShadow = false;
                child.receiveShadow = false;
            }
        });

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }

        const patternIndex = document.getElementById('pattern')?.value || '0';

        console.log('=== ENHANCED DEBUG INFORMATION ===');
        console.log('Image size:', this.debugInfo.imageSize);
        
        console.log('\nColor Mapping Analysis:');
        Object.entries(this.debugInfo.colorMapping).forEach(([part, info]) => {
            const [r, g, b] = info.color;
            console.log(`\n${part}:`);
            console.log(`  Base Color: RGB(${r}, ${g}, ${b})`);
            console.log(`  Current Tolerance: ${info.tolerance}`);
            
            const picker = document.getElementById(part + 'Color');
            if (picker) {
                const hex = picker.value;
                const selected = this.debugInfo.selectedColors[part]?.rgb;
                if (selected) {
                    console.log(`  Selected Color: RGB(${selected.r}, ${selected.g}, ${selected.b}), HEX: ${hex}`);
                }
            }
            
            const colorTotal = r + g + b;
            const dominantChannel = Math.max(r, g, b);
            const isRed = r === dominantChannel;
            const isGreen = g === dominantChannel;
            const isBlue = b === dominantChannel;
            
            console.log(`  Color Analysis:`);
            console.log(`    - Total Intensity: ${colorTotal}`);
            console.log(`    - Dominant Channel: ${isRed ? 'Red' : isGreen ? 'Green' : 'Blue'}`);
            console.log(`    - R:G:B Ratio: ${(r/dominantChannel).toFixed(2)}:${(g/dominantChannel).toFixed(2)}:${(b/dominantChannel).toFixed(2)}`);
            
            const count = this.debugInfo.pixelCounts[part] || 0;
            console.log(`  Matched Pixels: ${count}`);
            
            let recommendedTolerance = 10;
            
            if (patternIndex === '1' || patternIndex === '2') {
                const colorSpread = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
                recommendedTolerance = Math.max(5, Math.min(15, Math.floor(colorSpread * 0.15)));
            } else {
                recommendedTolerance = Math.max(5, Math.min(20, Math.floor(colorTotal * 0.02)));
            }
            
            console.log(`  Recommended Tolerance: ${recommendedTolerance}`);
            
            if (this.debugInfo.pixelCounts[part] > 0) {
                const expectedPixels = this.debugInfo.imageSize.width * this.debugInfo.imageSize.height / Object.keys(this.debugInfo.colorMapping).length;
                const overlapRatio = this.debugInfo.pixelCounts[part] / expectedPixels;
                console.log(`  Overlap Analysis:`);
                console.log(`    - Expected Pixels: ~${Math.floor(expectedPixels)}`);
                console.log(`    - Actual/Expected Ratio: ${overlapRatio.toFixed(2)}`);
                if (overlapRatio > 1.2) {
                    console.log('    ⚠️ WARNING: This part may be overlapping with others');
                }
            }
        });

        console.log('\nPattern Analysis:');
        console.log(`Current Pattern: ${patternIndex}`);
        console.log(`Pattern Characteristics:`);
        switch(patternIndex) {
            case '0':
                console.log('- Standard pattern (Default tolerance settings)');
                break;
            case '1':
                console.log('- Pattern B (Known for color bleeding issues)');
                console.log('- Recommended: Use stricter tolerance and color dominance checks');
                break;
            case '2':
                console.log('- Pattern C (Known for color bleeding issues)');
                console.log('- Recommended: Use stricter tolerance and color dominance checks');
                break;
        }

        console.log('\nRecommendations:');
        const totalPixels = Object.values(this.debugInfo.pixelCounts).reduce((a, b) => a + b, 0);
        const coverage = totalPixels / (this.debugInfo.imageSize.width * this.debugInfo.imageSize.height);
        console.log(`Total Coverage: ${(coverage * 100).toFixed(1)}%`);
        
        if (coverage > 1.1) {
            console.log('⚠️ WARNING: Significant overlap detected between parts');
            console.log('Recommendations:');
            console.log('1. Decrease tolerance values');
            console.log('2. Enable strict color dominance checks');
            console.log('3. Consider using unique color channels for each part');
        } else if (coverage < 0.9) {
            console.log('⚠️ WARNING: Gaps detected in color mapping');
            console.log('Recommendations:');
            console.log('1. Increase tolerance values');
            console.log('2. Check for missing color regions');
        }
    },

    showServerSelectionModal() {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-backdrop skin-creator-modal';
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; z-index: 10000;';

            overlay.innerHTML = `
                <div class="modal" style="background: rgba(13, 18, 14, 0.95); border: 1px solid #ffb300; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); max-width: 400px; width: 90%; padding: 2rem; border-radius: 12px; position: relative;" onclick="event.stopPropagation()">
                    <div class="modal-header" style="margin-bottom: 1.5rem; display: flex; justify-content: center; align-items: center; border-bottom: none; position: relative;">
                        <h2 style="font-family: Changa One, sans-serif; color: #ffb300; font-size: 1.8rem; text-transform: uppercase; letter-spacing: 1px; margin: 0; text-align: center;">Select Server</h2>
                        <button class="close-btn" style="position: absolute; right: 0; top: 50%; transform: translateY(-50%); background: none; border: none; color: #ccc; font-size: 1.5rem; cursor: pointer; line-height: 1; padding: 0.25rem;">×</button>
                    </div>
                    <div class="modal-body" style="display: flex; flex-direction: column; align-items: stretch; gap: 1rem; text-align: center;">
                        <p style="text-align: center; color: #ccc; margin: 0 0 0.5rem 0;">Please select the server region to apply your skin to.</p>
                        <button class="server-select-btn" data-server="EU" style="background: linear-gradient(90deg, rgba(33, 150, 243, 0.1), rgba(33, 150, 243, 0.2)); border: 1px solid rgba(33, 150, 243, 0.5); padding: 1rem; border-radius: 8px; color: #fff; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;">
                            EU Server
                        </button>
                        <button class="server-select-btn" data-server="NA" style="background: linear-gradient(90deg, rgba(244, 67, 54, 0.1), rgba(244, 67, 54, 0.2)); border: 1px solid rgba(244, 67, 54, 0.5); padding: 1rem; border-radius: 8px; color: #fff; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;">
                            NA Server
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            const cleanup = (result) => {
                overlay.style.display = 'none';
                setTimeout(() => {
                    if (overlay.parentNode) overlay.remove();
                }, 100);
                resolve(result);
            };

            overlay.querySelectorAll('.server-select-btn').forEach(btn => {
                btn.addEventListener('click', () => cleanup(btn.dataset.server));
            });
            overlay.querySelector('.close-btn').addEventListener('click', () => cleanup(null));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
        });
    },

    showProgressModal(title, content) {
        const existingModal = document.getElementById('skin-progress-modal');
        if (existingModal) {
            existingModal.remove();
        }

        const overlay = document.createElement('div');
        overlay.id = 'skin-progress-modal';
        overlay.className = 'modal-backdrop';
        overlay.style.display = 'flex';
        
        overlay.innerHTML = `
            <div class="modal" style="max-width: 400px; background: rgba(13, 18, 14, 0.85); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);">
                <div class="modal-header">
                    <h2 id="progress-title">${title}</h2>
                </div>
                <div class="modal-body" style="text-align: center; padding: 2rem;">
                    <div class="progress-spinner" style="margin-bottom: 1rem;">
                        <div style="width: 50px; height: 50px; border: 4px solid rgba(199, 146, 62, 0.2); border-top-color: var(--accent-gold, #c7923e); border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto;"></div>
                    </div>
                    <p id="progress-content" style="color: var(--text-soft); font-size: 1.1rem;">${content}</p>
                </div>
            </div>
        `;
        
        if (!document.getElementById('spin-animation-style')) {
            const style = document.createElement('style');
            style.id = 'spin-animation-style';
            style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
        }
        
        document.body.appendChild(overlay);
        
        return {
            update: (newTitle, newContent) => {
                const titleEl = document.getElementById('progress-title');
                const contentEl = document.getElementById('progress-content');
                if (titleEl) titleEl.textContent = newTitle;
                if (contentEl) contentEl.innerHTML = newContent;
            },
            close: () => {
                overlay.style.display = 'none';
                setTimeout(() => {
                    if (overlay.parentNode) {
                        overlay.remove();
                    }
                }, 100);
            }
        };
    },

    showModal(title, content, type = 'info', options = {}) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-backdrop skin-creator-modal';
        overlay.style.display = 'flex';
        
        let iconHtml = '';
        switch(type) {
            case 'success':
                iconHtml = '<i class="fas fa-check"></i>';
                break;
            case 'error':
                iconHtml = '<i class="fas fa-times"></i>';
                break;
            case 'info':
                iconHtml = '<i class="fas fa-info"></i>';
                break;
        }

        const cancelLabel = options.cancelText != null ? options.cancelText : 'Cancel';
        overlay.innerHTML = `
            <div class="modal modal-small">
                <div class="modal-header">
                    <div class="modal-icon ${type}">${iconHtml}</div>
                    <h2>${title}</h2>
                    <button type="button" class="close-btn" aria-label="Close">×</button>
                </div>
                <div class="modal-body">
                    <div class="modal-content">
                        ${content}
                        ${options.input ? `
                            <div class="app-input-wrapper" style="margin-top: 1rem; text-align: left;">
                                <input type="text" class="app-input modal-input" placeholder="${options.placeholder || ''}" value="${options.value || ''}" />
                            </div>
                        ` : ''}
                    </div>
                </div>
                <div class="modal-footer">
                    ${options.showCancel ? `
                        <button type="button" class="app-btn app-btn-red" data-action="cancel">${cancelLabel}</button>
                    ` : ''}
                    <button type="button" class="app-btn app-btn-green" data-action="confirm">${options.confirmText || 'OK'}</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);

        return new Promise((resolve) => {
            const confirmBtn = overlay.querySelector('[data-action="confirm"]');
            const cancelBtn = overlay.querySelector('[data-action="cancel"]');
            const closeBtn = overlay.querySelector('.close-btn');
            const input = overlay.querySelector('.modal-input');

            const cleanup = (result) => {
                overlay.style.display = 'none';
                setTimeout(() => {
                    document.body.removeChild(overlay);
                }, 300);
                resolve(result);
            };

            confirmBtn.addEventListener('click', () => {
                cleanup(input ? input.value : true);
            });

            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    cleanup(false);
                });
            }

            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    cleanup(false);
                });
            }

            if (!options.input) {
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) {
                        cleanup(false);
                    }
                });
            }
        });
    },

    showCooldownModalWithPatreon(timeMessage) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.85);
                backdrop-filter: blur(8px);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 9999;
                animation: fadeIn 0.3s ease-out;
            `;
            
            overlay.innerHTML = `
                <div class="glass-card" style="
                    width: 450px;
                    max-width: 90vw;
                    padding: 2.5rem;
                    border: 1px solid rgba(255, 179, 0, 0.3);
                    box-shadow: 0 0 40px rgba(255, 179, 0, 0.1), inset 0 0 20px rgba(255, 179, 0, 0.05);
                    animation: slideUp 0.3s ease-out;
                    background: rgba(13, 18, 14, 0.95);
                    backdrop-filter: blur(20px);
                    -webkit-backdrop-filter: blur(20px);
                ">
                    <div style="text-align: center; margin-bottom: 2rem;">
                        <h2 style="
                            font-family: 'Changa One', sans-serif;
                            font-size: 2rem;
                            color: #ffb300;
                            text-transform: uppercase;
                            letter-spacing: 1px;
                            margin-bottom: 0.5rem;
                        ">⏱️ Cooldown Active</h2>
                        <div class="scanline"></div>
                    </div>

                    <div style="
                        text-align: center;
                        background: rgba(0,0,0,0.3);
                        border-radius: 12px;
                        padding: 2rem;
                        border: 1px solid rgba(255, 179, 0, 0.2);
                        margin-bottom: 1.5rem;
                    ">
                        <div style="font-size: 4rem; margin-bottom: 1rem; animation: pulse 2s infinite;">⏳</div>
                        <p style="color: #aaa; margin-bottom: 0.5rem; font-size: 1rem;">
                            Please wait <strong style="color: #ffb300;">${timeMessage}</strong> before applying another skin.
                        </p>
                    </div>

                    <div style="
                        text-align: center;
                        background: rgba(255, 179, 0, 0.1);
                        border-radius: 12px;
                        padding: 1.5rem;
                        border: 1px solid rgba(255, 179, 0, 0.3);
                        margin-bottom: 1.5rem;
                    ">
                        <p style="color: #ffb300; font-size: 0.95rem; margin-bottom: 1rem; font-weight: 600;">
                            ⭐ Get Patreon to lower your cooldown!
                        </p>
                        <a href="https://www.patreon.com/NerfOfficial" target="_blank" rel="noopener noreferrer" style="text-decoration: none; display: inline-block;">
                            <button class="amber-btn" style="width: 100%; justify-content: center; padding: 0.75rem 1.5rem;">
                                <span>GET PATREON</span>
                            </button>
                        </a>
                    </div>

                    <button class="amber-btn close-cooldown-modal" style="width: 100%; justify-content: center;">
                        <span>CLOSE</span>
                    </button>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            const cleanup = () => {
                overlay.style.opacity = '0';
                setTimeout(() => {
                    if (overlay.parentNode) {
                        overlay.remove();
                    }
                    resolve(true);
                }, 300);
            };
            
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    cleanup();
                }
            });
            
            const closeBtn = overlay.querySelector('.close-cooldown-modal');
            if (closeBtn) {
                closeBtn.addEventListener('click', cleanup);
            }
        });
    },

    async savePreset() {
        try {
            const saveAsGlitch = this.isGlitchSkinMode() && this.canSaveFullGlitchPreset();
            if (this.isGlitchSkinMode() && !this.canSaveFullGlitchPreset()) {
                this.syncGlitchFloatsToHexPickers();
            }

            const presetName = await this.showModal(
                'Save Preset',
                saveAsGlitch
                    ? 'Enter a name for this glitch preset:'
                    : 'Enter a name for this preset:',
                'info',
                {
                    input: true,
                    placeholder: 'Preset name',
                    showCancel: true,
                    confirmText: 'Save'
                }
            );

            if (!presetName) return; 

            const storeKey = saveAsGlitch ? this.PRESET_KEY_GLITCH : this.PRESET_KEY;
            const presets = JSON.parse(localStorage.getItem(storeKey)) || {};

            if (presets[presetName]) {
                const overwrite = await this.showModal(
                    'Confirm Overwrite',
                    `A ${saveAsGlitch ? 'glitch ' : ''}preset named "${presetName}" already exists. Overwrite it?`,
                    'info',
                    {
                        showCancel: true,
                        confirmText: 'Overwrite'
                    }
                );
                if (!overwrite) return;
            }

            if (this.isGlitchSkinMode()) {
                this.syncGlitchFloatsToHexPickers();
            }

            const currentSettings = {
                colors: {},
                patternVariation: document.getElementById('pattern-variation')?.value || '0',
                pattern: document.getElementById('pattern')?.value || '0',
                gender: document.querySelector('input[name="gender"]:checked')?.value || 'male',
                sunAzimuth: OASIS_SKIN_EXPORT_SUN_AZIMUTH,
                sunIntensity: OASIS_SKIN_EXPORT_SUN_INTENSITY,
                timestamp: new Date().toISOString()
            };

            if (window.colorPickers) {
                Object.entries(window.colorPickers).forEach(([key, picker]) => {
                    if (picker) {
                        currentSettings.colors[key] = picker.value;
                    }
                });
            } else {
                document.querySelectorAll('input[type="color"]').forEach((input) => {
                    if (input.id) {
                        currentSettings.colors[input.id] = input.value;
                    }
                });
            }

            if (saveAsGlitch) {
                currentSettings.glitchSkin = true;
                currentSettings.glitchColors = {};
                SKIN_COLOR_INPUT_IDS.forEach((id) => {
                    currentSettings.glitchColors[id] = this.getSkinColorRgb(id);
                });
            }

            presets[presetName] = currentSettings;
            localStorage.setItem(storeKey, JSON.stringify(presets));

            this.updatePresetsDropdown();

            await this.showModal(
                'Success',
                saveAsGlitch
                    ? `Glitch preset "${presetName}" saved successfully!`
                    : `Preset "${presetName}" saved successfully!`,
                'success',
                { confirmText: 'OK' }
            );
        } catch (error) {
            console.error('Error saving preset:', error);
            await this.showModal(
                'Error',
                `Failed to save preset: ${error.message || 'Unknown error'}`,
                'error',
                { confirmText: 'OK' }
            );
        }
    },

    async loadPreset(presetName, bucket) {
        try {
            const storeKey = bucket === 'glitch' ? this.PRESET_KEY_GLITCH : this.PRESET_KEY;
            const presets = JSON.parse(localStorage.getItem(storeKey)) || {};
            const preset = presets[presetName];

            if (!preset) {
                await this.showModal(
                    'Error',
                    `Preset "${presetName}" not found!`,
                    'error',
                    { confirmText: 'OK' }
                );
                return;
            }

            const patternVariation = document.getElementById('pattern-variation');
            const pattern = document.getElementById('pattern');
            const genderInput = document.querySelector(`input[name="gender"][value="${preset.gender}"]`);

            if (patternVariation) patternVariation.value = preset.patternVariation;
            if (pattern) pattern.value = preset.pattern;
            if (genderInput) genderInput.checked = true;

            if (bucket === 'glitch') {
                if (!this.canSaveFullGlitchPreset()) {
                    await this.showModal(
                        'Error',
                        'Glitch presets require Sub Patreon tier or higher.',
                        'error',
                        { confirmText: 'OK' }
                    );
                    return;
                }
                if (!preset.glitchColors || typeof preset.glitchColors !== 'object') {
                    await this.showModal(
                        'Error',
                        'This glitch preset is missing color data.',
                        'error',
                        { confirmText: 'OK' }
                    );
                    return;
                }
                this._applyFullGlitchEditorFromPreset(preset);
                this.scheduleUpdateModelColors(true);
            } else {
                const marker = document.getElementById('glitch-skin-mode');
                if (marker) {
                    marker.dataset.active = 'false';
                    window.dispatchEvent(new CustomEvent('skinCreatorGlitchState', { detail: { active: false } }));
                }

                if (window.colorPickers) {
                    Object.entries(preset.colors || {}).forEach(([key, value]) => {
                        if (window.colorPickers[key]) {
                            window.colorPickers[key].value = value;
                            window.colorPickers[key].dispatchEvent(new Event('input'));
                        }
                    });
                } else {
                    Object.entries(preset.colors || {}).forEach(([key, value]) => {
                        const input = document.getElementById(key);
                        if (input) {
                            input.value = value;
                            input.dispatchEvent(new Event('input'));
                        }
                    });
                }
                this.updateModelColors();
            }

            await this.showModal(
                'Success',
                bucket === 'glitch'
                    ? `Glitch preset "${presetName}" loaded successfully!`
                    : `Preset "${presetName}" loaded successfully!`,
                'success',
                { confirmText: 'OK' }
            );
        } catch (error) {
            console.error('Error loading preset:', error);
            await this.showModal(
                'Error',
                `Failed to load preset: ${error.message || 'Unknown error'}`,
                'error',
                { confirmText: 'OK' }
            );
        }
    },

    async deletePreset(presetName, bucket) {
        try {
            const storeKey = bucket === 'glitch' ? this.PRESET_KEY_GLITCH : this.PRESET_KEY;
            const presets = JSON.parse(localStorage.getItem(storeKey)) || {};

            if (!presets[presetName]) {
                await this.showModal(
                    'Error',
                    `Preset "${presetName}" not found!`,
                    'error',
                    { confirmText: 'OK' }
                );
                return;
            }

            const confirm = await this.showModal(
                'Confirm Delete',
                `Delete ${bucket === 'glitch' ? 'glitch ' : ''}preset "${presetName}"?`,
                'error',
                {
                    showCancel: true,
                    confirmText: 'Delete'
                }
            );

            if (!confirm) return;

            delete presets[presetName];
            localStorage.setItem(storeKey, JSON.stringify(presets));

            this.updatePresetsDropdown();

            await this.showModal(
                'Success',
                `Preset "${presetName}" deleted successfully!`,
                'success',
                { confirmText: 'OK' }
            );
        } catch (error) {
            console.error('Error deleting preset:', error);
            await this.showModal(
                'Error',
                `Failed to delete preset: ${error.message || 'Unknown error'}`,
                'error',
                { confirmText: 'OK' }
            );
        }
    },

    async checkAdminStatus(discordId) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/status`, {
                method: 'GET',
                credentials: 'include'
            });

            if (!response.ok) {
                return false;
            }

            const data = await response.json();
            return data.authenticated && (data.user?.isAdmin === true || data.user?.canAccessAdminPanel === true);
        } catch (error) {
            console.error('Error checking admin status:', error);
            return false;
        }
    },

    async getCsrfToken() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/csrf-token`, {
                credentials: 'include'
            });
            const data = await response.json();
            return data.token || data.csrfToken;
        } catch (error) {
            console.error('Error getting CSRF token:', error);
            return 'csrf-placeholder';
        }
    },

    async applySkin() {
        let progressModal = null;
        
        try {
            const server = await this.showServerSelectionModal();
            if (!server) return; 

            progressModal = this.showProgressModal('Applying Skin', '🔄 Checking login status...');
            
const discordId = "local_offline_user";
console.log('Applying skin for user:', discordId);
            
            progressModal.update('Applying Skin', '🔄 Checking permissions...');
            
            const csrfToken = await this.getCsrfToken();
            
            const isAdmin = await this.checkAdminStatus(discordId);
            console.log('User admin status:', isAdmin);
            
            if (!isAdmin) {
                progressModal.update('Applying Skin', '🔄 Checking cooldown...');
                console.log('User is not admin, checking cooldown...');
                
                const reductionResponse = await fetch(`${API_BASE_URL}/api/skin-cooldown-reduction`, {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include'
                });
                
                if (!reductionResponse.ok) {
                    console.warn('Failed to check cooldown reduction, using default');
                }
                
                let cooldownReduction = 0;
                try {
                    const reductionData = await reductionResponse.json();
                    console.log('Cooldown reduction data:', reductionData);
                    cooldownReduction = reductionData.reduction || 0;
                } catch (error) {
                    console.warn('Error parsing cooldown reduction data:', error);
                    cooldownReduction = 0;
                }
                
                const baseCooldown = 1800000;
                const adjustedCooldown = Math.max(60000, baseCooldown * (1 - cooldownReduction));
                
                const cooldownKey = `lastSkinApplied_${discordId}`;
                const lastApplied = localStorage.getItem(cooldownKey);
                
                if (lastApplied) {
                    const lastAppliedTime = parseInt(lastApplied);
                    const timeDiff = Date.now() - lastAppliedTime;
                    const timeLeft = adjustedCooldown - timeDiff;
                    
                    if (timeLeft > 0) {
                        const minutesLeft = Math.ceil(timeLeft / 60000);
                        const secondsLeft = Math.ceil((timeLeft % 60000) / 1000);
                        
                        let timeMessage;
                        if (minutesLeft > 0) {
                            timeMessage = `${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}`;
                            if (minutesLeft === 1 && secondsLeft > 0) {
                                timeMessage += ` and ${secondsLeft} second${secondsLeft > 1 ? 's' : ''}`;
                            }
                        } else {
                            timeMessage = `${secondsLeft} second${secondsLeft > 1 ? 's' : ''}`;
                        }
                        
                        let hasPatreon = false;
                        try {
                            const authResponse = await fetch(`${API_BASE_URL}/api/auth/status`, {
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'include'
                            });
                            if (authResponse.ok) {
                                const authData = await authResponse.json();
                                hasPatreon = authData.user?.hasPatreonRole === true;
                            }
                        } catch (error) {
                            console.warn('Failed to check Patreon status:', error);
                        }
                        
                        progressModal.close();
                        
                        if (!hasPatreon) {
                            await this.showCooldownModalWithPatreon(timeMessage);
                        } else {
                            await this.showModal(
                                'Cooldown Active',
                                `⏳ Please wait ${timeMessage} before applying another skin.`,
                                'error',
                                { confirmText: 'OK' }
                            );
                        }
                        return;
                    }
                }
            }

            progressModal.update('Applying Skin', '🔄 Verifying Steam ID...');
            
            const steamidResponse = await fetch(`${API_BASE_URL}/api/get-steamid`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include'
            });
            
            if (!steamidResponse.ok) {
                throw new Error('Failed to get Steam ID');
            }
            
            const steamidData = await steamidResponse.json();
            
            if (!steamidData.steamid) {
                progressModal.close();
                await this.showModal(
                    'Error',
                    '🔗 Please link your Steam ID first.',
                    'error',
                    { confirmText: 'OK' }
                );
                return;
            }

            const steamid = steamidData.steamid;

            progressModal.update('Applying Skin', '🎮 Checking if you are online on the server...');

            const glitchSkin = this.isGlitchSkinMode();
            const colors = {
                maleDisplayColor: this.getSkinColorRgb('maleDisplayColor'),
                markingsColor: this.getSkinColorRgb('markingsColor'),
                bodyColor: this.getSkinColorRgb('bodyColor'),
                flankColor: this.getSkinColorRgb('flankColor'),
                underbellyColor: this.getSkinColorRgb('underbellyColor'),
                detail1Color: this.getSkinColorRgb('detail1Color'),
                eyesColor: this.getSkinColorRgb('eyesColor')
            };

            const genderInput = document.querySelector('input[name="gender"]:checked');
            const gender = genderInput ? genderInput.value : 'male';
            const genderParam = gender === 'female' ? 'f' : 'm';

            const skinVariation = parseFloat(document.getElementById('pattern-variation').value);
            const pattern = parseInt(document.getElementById('pattern').value);

            if (!discordId) {
                throw new Error('Discord ID is not available. Please make sure you are logged in.');
            }

            progressModal.update('Applying Skin', '🎨 Sending skin to game server...');

            const response = await fetch(`${API_BASE_URL}/api/apply-skin`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    gender: genderParam,
                    skinVariation: skinVariation,
                    pattern: pattern,
                    glitchSkin: glitchSkin,
                    maleDisplayColor: colors.maleDisplayColor,
                    markingsColor: colors.markingsColor,
                    bodyColor: colors.bodyColor,
                    flankColor: colors.flankColor,
                    underbellyColor: colors.underbellyColor,
                    detail1Color: colors.detail1Color,
                    eyesColor: colors.eyesColor,
                    server: server
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Server response:', {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorData
                });
                
                if (response.status === 401) {
                    throw new Error('Please log in to apply skins');
                } else if (response.status === 403) {
                    const msg =
                        errorData.message ||
                        (errorData.code === 'GLITCH_SKIN_PATREON'
                            ? 'Glitch skins require Sub Patreon tier or higher.'
                            : null);
                    throw new Error(msg || 'You do not have permission to apply skins');
                } else if (response.status === 429) {
                    throw new Error(errorData.message || 'Please wait before applying another skin');
                } else if (errorData.error === 'Not online') {
                    throw new Error(errorData.message || 'You must be logged into the game server to apply a skin');
                } else if (errorData.error === 'Cannibalistic') {
                    throw new Error(errorData.message || 'Cannot apply skin if you have Cannibalistic mutation');
                }
                
                throw new Error(errorData.message || errorData.error || `Server error: ${response.status}`);
            }

            const result = await response.json();

            progressModal.close();

            if (result.success) {
                if (!isAdmin) {
                    const cooldownKey = `lastSkinApplied_${discordId}`;
                    localStorage.setItem(cooldownKey, Date.now().toString());
                }
                
                await this.showModal(
                    'Success',
                    '✅ Skin applied successfully!\n\nYour dinosaur now has the new skin.',
                    'success',
                    { confirmText: 'OK' }
                );
            } else {
                throw new Error(result.message || 'Failed to apply skin');
            }

        } catch (error) {
            console.error('Error applying skin:', error);
            
            if (progressModal) {
                progressModal.close();
            }
            
            let errorMessage = error.message;
            let errorTitle = 'Error';
            
            if (error.message.includes('Cannibalistic')) {
                errorTitle = 'Cannot Apply Skin';
                errorMessage = 'Cannot apply skin if you have Cannibalistic mutation';
            } else if (error.message.includes('Not online') || error.message.includes('logged into the game')) {
                errorTitle = 'Not Online';
                errorMessage = '🎮 You must be logged into the game server to apply a skin.\n\nPlease join the server and try again.';
            } else if (error.message.includes('Failed to communicate with dino service')) {
                errorMessage = '🔌 The game server is currently unavailable.\n\nPlease try again later.';
            } else if (error.message.includes('Failed to get Steam ID') || error.message.includes('Steam account is linked')) {
                errorMessage = '🔗 Could not verify your Steam ID.\n\nPlease make sure your Steam account is linked.';
            } else if (error.message.includes('Cooldown')) {
                errorTitle = 'Cooldown Active';
            }
            
            await this.showModal(
                errorTitle,
                `❌ ${errorMessage}`,
                'error',
                { confirmText: 'OK' }
            );
        }
    },

    isGlitchSkinMode() {
        const el = document.getElementById('glitch-skin-mode');
        if (!el) return false;
        const raw = el.getAttribute('data-active');
        if (raw === 'true') return true;
        if (raw === 'false') return false;
        return String(el.dataset.active || '') === 'true';
    },

    canSaveFullGlitchPreset() {
        const m = document.getElementById('glitch-skin-mode');
        return !!(m && m.dataset.canGlitch === 'true');
    },

    _applyFullGlitchEditorFromPreset(preset) {
        if (!preset || !preset.glitchColors || typeof preset.glitchColors !== 'object') return false;
        const marker = document.getElementById('glitch-skin-mode');
        if (!marker || marker.dataset.canGlitch !== 'true') return false;

        SKIN_COLOR_INPUT_IDS.forEach((id) => {
            const rgb = preset.glitchColors[id];
            if (!rgb || typeof rgb !== 'object') return;
            ['r', 'g', 'b'].forEach((axis) => {
                const el = document.getElementById(`${id}-${axis}`);
                if (!el) return;
                const v = rgb[axis];
                const n = Number(v);
                el.value =
                    v !== undefined && v !== null && Number.isFinite(n)
                        ? String(clampGlitchLinearChannel(n))
                        : '0';
            });
            const hexEl = document.getElementById(id);
            if (hexEl) {
                hexEl.value = this.floatRgbToHexForPicker(
                    Number(rgb.r) || 0,
                    Number(rgb.g) || 0,
                    Number(rgb.b) || 0
                );
            }
        });
        marker.dataset.active = 'true';
        window.dispatchEvent(new CustomEvent('skinCreatorGlitchState', { detail: { active: true } }));
        return true;
    },

    _wirePresetSelectMutex(signal) {
        const selN = document.getElementById('presets-select');
        const selG = document.getElementById('presets-select-glitch');
        if (!selN || !selG) return;
        selN.addEventListener(
            'change',
            () => {
                if (selN.value) selG.value = '';
            },
            { signal }
        );
        selG.addEventListener(
            'change',
            () => {
                if (selG.value) selN.value = '';
            },
            { signal }
        );
    },

    _getSelectedPresetBucketName() {
        const selG = document.getElementById('presets-select-glitch');
        const selN = document.getElementById('presets-select');
        const g = selG && selG.value;
        const n = selN && selN.value;
        if (g) return { bucket: 'glitch', name: g };
        if (n) return { bucket: 'normal', name: n };
        return null;
    },

    getSkinColorRgb(inputId) {
        if (this.isGlitchSkinMode()) {
            const parseCh = (suffix) => {
                const el = document.getElementById(`${inputId}-${suffix}`);
                if (!el || el.value === '') return 0;
                const n = skinParseRgbFieldNumber(el.value);
                return clampGlitchLinearChannel(Number.isFinite(n) ? n : 0);
            };
            return {
                r: parseCh('r'),
                g: parseCh('g'),
                b: parseCh('b')
            };
        }
        const hexEl = document.getElementById(inputId);
        return this.hexToRgb(hexEl ? hexEl.value : '#000000') || { r: 0, g: 0, b: 0 };
    },

    getSkinColorPreviewBytes(inputId) {
        const rgb = this.getSkinColorRgb(inputId);
        if (this.isGlitchSkinMode()) {
            return {
                r: glitchFloatToPreviewByte(rgb.r),
                g: glitchFloatToPreviewByte(rgb.g),
                b: glitchFloatToPreviewByte(rgb.b)
            };
        }
        return rgb;
    },

    syncGlitchFloatsToHexPickers() {
        if (!this.isGlitchSkinMode()) return;
        const ids = SKIN_COLOR_INPUT_IDS;
        ids.forEach((id) => {
            const rgb = this.getSkinColorRgb(id);
            const hexEl = document.getElementById(id);
            if (!hexEl) return;
            hexEl.value = this.floatRgbToHexForPicker(rgb.r, rgb.g, rgb.b);
        });
    },

    floatRgbToHexForPicker(r, g, b) {
        const R = glitchChannelToDisplayByte(r),
            G = glitchChannelToDisplayByte(g),
            B = glitchChannelToDisplayByte(b);
        return '#' + [R, G, B].map((x) => x.toString(16).padStart(2, '0')).join('');
    },

    syncColorPreviewDots() {
        const ids = SKIN_COLOR_INPUT_IDS;
        ids.forEach((id) => {
            const previewId = id.replace('Color', '') + 'Preview';
            const preview = document.getElementById(previewId);
            if (!preview) return;
            const rgb = this.getSkinColorPreviewBytes(id);
            preview.style.backgroundColor = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
            preview.style.boxShadow = `0 0 15px rgb(${rgb.r},${rgb.g},${rgb.b})`;
        });
    },

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    },

    generateSkinCode() {
        if (this.isGlitchSkinMode()) {
            this.syncGlitchFloatsToHexPickers();
        }

        const settings = {
            colors: {},
            patternVariation: document.getElementById('pattern-variation')?.value || '0',
            pattern: document.getElementById('pattern')?.value || '0',
            gender: document.querySelector('input[name="gender"]:checked')?.value || 'male',
            model: document.getElementById('modelSelect')?.value || 'Allosaurus',
            sunAzimuth: OASIS_SKIN_EXPORT_SUN_AZIMUTH,
            sunIntensity: OASIS_SKIN_EXPORT_SUN_INTENSITY
        };

        SKIN_COLOR_INPUT_IDS.forEach((id) => {
            const input = document.getElementById(id);
            if (input) {
                settings.colors[id] = input.value;
            }
        });

        if (this.isGlitchSkinMode()) {
            settings.glitchSkin = true;
            settings.glitchColors = {};
            SKIN_COLOR_INPUT_IDS.forEach((id) => {
                settings.glitchColors[id] = this.getSkinColorRgb(id);
            });
        }

        const jsonStr = JSON.stringify(settings);
        const code = btoa(jsonStr);
        return code;
    },

    loadSkinCode(code) {
        try {
            const jsonStr = atob(code);
            const settings = JSON.parse(jsonStr);

            const marker = document.getElementById('glitch-skin-mode');
            const useGlitchImport =
                settings.glitchSkin === true &&
                settings.glitchColors &&
                typeof settings.glitchColors === 'object';
            const canGlitchImport = !!(marker && marker.dataset.canGlitch === 'true');

            const modelSelect = document.getElementById('modelSelect');
            if (modelSelect && settings.model) {
                modelSelect.value = settings.model;
                this.loadModel(settings.model);
            }

            const patternVariation = document.getElementById('pattern-variation');
            const pattern = document.getElementById('pattern');
            const genderInput = document.querySelector(`input[name="gender"][value="${settings.gender}"]`);

            if (patternVariation) patternVariation.value = settings.patternVariation;
            if (pattern) pattern.value = settings.pattern;
            if (genderInput) genderInput.checked = true;

            if (useGlitchImport && canGlitchImport) {
                SKIN_COLOR_INPUT_IDS.forEach((id) => {
                    const rgb = settings.glitchColors[id];
                    if (!rgb || typeof rgb !== 'object') return;
                    ['r', 'g', 'b'].forEach((axis) => {
                        const el = document.getElementById(`${id}-${axis}`);
                        if (!el) return;
                        const v = rgb[axis];
                        const n = Number(v);
                        el.value =
                            v !== undefined && v !== null && Number.isFinite(n)
                                ? String(clampGlitchLinearChannel(n))
                                : '0';
                    });
                    const hexEl = document.getElementById(id);
                    if (hexEl) {
                        const cr = clampGlitchLinearChannel(Number(rgb.r) || 0);
                        const cg = clampGlitchLinearChannel(Number(rgb.g) || 0);
                        const cb = clampGlitchLinearChannel(Number(rgb.b) || 0);
                        hexEl.value = this.floatRgbToHexForPicker(cr, cg, cb);
                    }
                });
                if (marker) marker.dataset.active = 'true';
                window.dispatchEvent(new CustomEvent('skinCreatorGlitchState', { detail: { active: true } }));
            } else if (useGlitchImport && !canGlitchImport) {
                if (marker) marker.dataset.active = 'false';
                window.dispatchEvent(new CustomEvent('skinCreatorGlitchState', { detail: { active: false } }));
                SKIN_COLOR_INPUT_IDS.forEach((id) => {
                    const rgb = settings.glitchColors[id];
                    if (!rgb || typeof rgb !== 'object') return;
                    const hexEl = document.getElementById(id);
                    if (hexEl) {
                        hexEl.value = this.floatRgbToHexForPicker(
                            Number(rgb.r) || 0,
                            Number(rgb.g) || 0,
                            Number(rgb.b) || 0
                        );
                        hexEl.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    ['r', 'g', 'b'].forEach((axis) => {
                        const el = document.getElementById(`${id}-${axis}`);
                        if (el) {
                            el.value = String(
                                glitchChannelToDisplayByte(Number(rgb[axis]) || 0)
                            );
                        }
                    });
                });
            } else {
                if (marker) marker.dataset.active = 'false';
                window.dispatchEvent(new CustomEvent('skinCreatorGlitchState', { detail: { active: false } }));

                if (settings.colors) {
                    Object.entries(settings.colors).forEach(([key, value]) => {
                        const input = document.getElementById(key);
                        if (input) {
                            input.value = value;
                            input.dispatchEvent(new Event('input'));
                        }
                    });
                }
            }

            this.scheduleUpdateModelColors(true);
            return true;
        } catch (error) {
            console.error('Error loading skin code:', error);
            return false;
        }
    },

    initializeEventListeners() {
        if (this._listenersAbortController) {
            this._listenersAbortController.abort();
        }
        this._listenersAbortController = new AbortController();
        const ac = this._listenersAbortController;

        const modelSelect = document.getElementById('modelSelect');
        const patternSelect = document.getElementById('pattern');
        const saveSkin = document.getElementById('saveSkin');
        const randomizeBtn = document.getElementById('randomizeBtn');
        const savePresetBtn = document.getElementById('savePresetBtn');
        const applyBtn = document.getElementById('applyBtn');
        
        const colorPickers = {
            maleDisplayColor: document.getElementById('maleDisplayColor'),
            markingsColor: document.getElementById('markingsColor'),
            bodyColor: document.getElementById('bodyColor'),
            flankColor: document.getElementById('flankColor'),
            underbellyColor: document.getElementById('underbellyColor'),
            detail1Color: document.getElementById('detail1Color'),
            eyesColor: document.getElementById('eyesColor')
        };
        
        window.colorPickers = colorPickers;

        const onGlitchAxisDocument = (e) => {
            const t = e.target;
            if (!t || t.tagName !== 'INPUT') return;
            const id = t.id;
            if (!id) return;
            let matched = false;
            for (let i = 0; i < SKIN_COLOR_INPUT_IDS.length; i++) {
                const bid = SKIN_COLOR_INPUT_IDS[i];
                if (id === `${bid}-r` || id === `${bid}-g` || id === `${bid}-b`) {
                    matched = true;
                    break;
                }
            }
            if (!matched) return;
            if (!this.isGlitchSkinMode()) return;
            if (e.type === 'input') {
                this.scheduleUpdateModelColors(false);
            } else if (e.type === 'change') {
                this.scheduleUpdateModelColors(true);
            }
        };
        document.addEventListener('input', onGlitchAxisDocument, { capture: true, signal: ac.signal });
        document.addEventListener('change', onGlitchAxisDocument, { capture: true, signal: ac.signal });

        const onGlitchAxisFocusOut = (e) => {
            const t = e.target;
            if (!t || t.tagName !== 'INPUT') return;
            const id = t.id;
            let matched = false;
            for (let i = 0; i < SKIN_COLOR_INPUT_IDS.length; i++) {
                const bid = SKIN_COLOR_INPUT_IDS[i];
                if (id === `${bid}-r` || id === `${bid}-g` || id === `${bid}-b`) {
                    matched = true;
                    break;
                }
            }
            if (!matched || !this.isGlitchSkinMode()) return;
            this.scheduleUpdateModelColors(true);
        };
        document.addEventListener('focusout', onGlitchAxisFocusOut, { capture: true, signal: ac.signal });

        const refreshAfterGlitchUiReady = () => {
            if (!this.isGlitchSkinMode()) return;
            this.scheduleUpdateModelColors(true);
        };
        window.addEventListener(
            'skinCreatorGlitchState',
            (ev) => {
                if (ev && ev.detail && ev.detail.active) {
                    requestAnimationFrame(() => refreshAfterGlitchUiReady());
                }
            },
            { signal: ac.signal }
        );

        Object.entries(colorPickers).forEach(([key, picker]) => {
            if (picker) {
                let pickerCommitRaf = null;
                const schedulePickerCommit = () => {
                    if (pickerCommitRaf != null) {
                        cancelAnimationFrame(pickerCommitRaf);
                    }
                    pickerCommitRaf = requestAnimationFrame(() => {
                        pickerCommitRaf = null;
                        this.syncHexPickerToGlitchFloats(picker.id);
                        this.scheduleUpdateModelColors(true);
                    });
                };
                const onPickerInput = () => {
                    this.syncHexPickerToGlitchFloats(picker.id);
                    if (this.isGlitchSkinMode()) {
                        this.scheduleUpdateModelColors(false);
                        return;
                    }
                    const m = this._currentSkinManifest;
                    if (m && m.BodyMaterial && m.BodyMaterial.Textures && m.BodyMaterial.Textures.BaseMask) {
                        this._scheduleManifestColorPreviewRefresh();
                    } else {
                        this.scheduleUpdateModelColors(false);
                    }
                };
                picker.addEventListener('input', onPickerInput, { signal: ac.signal });
                picker.addEventListener('change', schedulePickerCommit, { signal: ac.signal });
                picker.addEventListener('blur', schedulePickerCommit, { signal: ac.signal });
            }
        });
        
        if (modelSelect) {
            modelSelect.addEventListener('change', (e) => {
                this.loadModel(e.target.value);
            }, { signal: ac.signal });
        }

        const animSelect = document.getElementById('skinCreatorAnimationSelect');
        if (animSelect) {
            animSelect.addEventListener('change', () => {
                const idx = parseInt(animSelect.value, 10);
                if (!Number.isNaN(idx)) {
                    this.setAnimationClipIndex(idx);
                }
            }, { signal: ac.signal });
        }
        
        if (patternSelect) {
            patternSelect.addEventListener('input', () => {
                console.log('Pattern changed to:', patternSelect.value);
                this.updateModelColors();
            }, { signal: ac.signal });
        }

        if (randomizeBtn) {
            randomizeBtn.addEventListener('click', () => {
                    if (this.isGlitchSkinMode()) {
                    const glitchAxes = ['r', 'g', 'b'];
                    Object.keys(colorPickers).forEach((key) => {
                        glitchAxes.forEach((axis) => {
                            const el = document.getElementById(`${key}-${axis}`);
                            if (el) {
                                const raw = Math.random() * 20000 - 10000;
                                el.value = String(clampGlitchLinearChannel(raw).toFixed(2));
                            }
                        });
                    });
                    this.scheduleUpdateModelColors(true);
                    return;
                }
                Object.values(colorPickers).forEach(picker => {
                    if (picker) {
                        const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
                        picker.value = randomColor;
                        picker.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                });
                this.updateModelColors();
            }, { signal: ac.signal });
        }

        const loadPresetBtn = document.getElementById('loadPresetBtn');
        if (loadPresetBtn) {
            loadPresetBtn.addEventListener('click', () => {
                const picked = this._getSelectedPresetBucketName();
                if (picked) {
                    this.loadPreset(picked.name, picked.bucket);
                } else {
                    this.showModal(
                        'Error',
                        'Please select a standard or glitch preset.',
                        'error',
                        { confirmText: 'OK' }
                    );
                }
            }, { signal: ac.signal });
        }

        const deletePresetBtn = document.getElementById('deletePresetBtn');
        if (deletePresetBtn) {
            deletePresetBtn.addEventListener('click', () => {
                const picked = this._getSelectedPresetBucketName();
                if (picked) {
                    this.deletePreset(picked.name, picked.bucket);
                } else {
                    this.showModal(
                        'Error',
                        'Please select a preset to delete.',
                        'error',
                        { confirmText: 'OK' }
                    );
                }
            }, { signal: ac.signal });
        }

        if (savePresetBtn) {
            savePresetBtn.addEventListener('click', () => {
                this.savePreset();
            }, { signal: ac.signal });
        }

        this._wirePresetSelectMutex(ac.signal);

        const genderRadios = document.querySelectorAll('input[name="gender"]');
        genderRadios.forEach(radio => {
            radio.addEventListener('change', function() {
                console.log('Gender changed to:', this.value);
            }, { signal: ac.signal });
        });

        if (saveSkin) {
            saveSkin.addEventListener('click', async () => {
                const skinData = {
                    model: modelSelect.value,
                    colors: {},
                    pattern: patternSelect.value,
                    patternVariation: document.getElementById('pattern-variation')?.value || '0',
                    gender: document.querySelector('input[name="gender"]:checked')?.value || 'male'
                };

                Object.entries(colorPickers).forEach(([key, picker]) => {
                    if (picker) {
                        skinData.colors[key] = picker.value;
                    }
                });
                
                try {
                    const savedSkins = JSON.parse(localStorage.getItem('savedSkins') || '[]');
                    savedSkins.push({
                        ...skinData,
                        savedAt: new Date().toISOString()
                    });
                    localStorage.setItem('savedSkins', JSON.stringify(savedSkins.slice(-10))); 
                    
                    await this.showModal(
                        'Success',
                        'Skin saved locally!',
                        'success',
                        { confirmText: 'OK' }
                    );
                } catch (error) {
                    console.error('Error saving skin:', error);
                    await this.showModal(
                        'Error',
                        'Failed to save skin. Please try again.',
                        'error',
                        { confirmText: 'OK' }
                    );
                }
            }, { signal: ac.signal });
        }

        const getCodeBtn = document.getElementById('getCodeBtn');
        const loadCodeBtn = document.getElementById('loadCodeBtn');

        if (getCodeBtn) {
            getCodeBtn.addEventListener('click', async () => {
                const code = this.generateSkinCode();
                await this.showModal(
                    'Skin Code',
                    `<div style="word-break: break-all;">Share this code with others:<br><br><code>${code}</code></div>`,
                    'info',
                    {
                        confirmText: 'Copy Code',
                        showCancel: true
                    }
                ).then(shouldCopy => {
                    if (shouldCopy) {
                        navigator.clipboard.writeText(code).then(() => {
                            this.showModal(
                                'Success',
                                'Code copied to clipboard!',
                                'success',
                                { confirmText: 'OK' }
                            );
                        });
                    }
                });
            }, { signal: ac.signal });
        }

        if (loadCodeBtn) {
            loadCodeBtn.addEventListener('click', async () => {
                const result = await this.showModal(
                    'Load Skin Code',
                    'Enter the skin code:',
                    'info',
                    {
                        input: true,
                        placeholder: 'Paste skin code here',
                        showCancel: true,
                        confirmText: 'Load'
                    }
                );

                if (result) {
                    const success = this.loadSkinCode(result);
                    if (success) {
                        await this.showModal(
                            'Success',
                            'Skin loaded successfully!',
                            'success',
                            { confirmText: 'OK' }
                        );
                    } else {
                        await this.showModal(
                            'Error',
                            'Invalid skin code. Please check the code and try again.',
                            'error',
                            { confirmText: 'OK' }
                        );
                    }
                }
            }, { signal: ac.signal });
        }

        const debugBtn = document.getElementById('debugBtn');
        if (debugBtn) {
            debugBtn.addEventListener('click', () => {
                this.debugColors();
            }, { signal: ac.signal });
        }

        if (applyBtn) {
            applyBtn.addEventListener('click', async () => {
                const button = applyBtn;
                const originalText = button.innerHTML;
                button.disabled = true;
                button.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Applying...';

                try {
                    await this.applySkin();
                } finally {
                    button.disabled = false;
                    button.innerHTML = originalText;
                }
            }, { signal: ac.signal });
        }
    },

    updatePresetsDropdown() {
        const normal = JSON.parse(localStorage.getItem(this.PRESET_KEY)) || {};
        const glitch = JSON.parse(localStorage.getItem(this.PRESET_KEY_GLITCH)) || {};

        const selN = document.getElementById('presets-select');
        if (selN) {
            const curN = selN.value;
            selN.innerHTML = '<option value="">-- Standard presets --</option>';
            Object.keys(normal)
                .sort((a, b) => a.localeCompare(b))
                .forEach((name) => {
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = name;
                    selN.appendChild(option);
                });
            if (normal[curN]) selN.value = curN;
        } else {
            console.warn('Presets select element not found');
        }

        const selG = document.getElementById('presets-select-glitch');
        if (selG) {
            const curG = selG.value;
            selG.innerHTML = '<option value="">-- Glitch presets (Sub+) --</option>';
            Object.keys(glitch)
                .sort((a, b) => a.localeCompare(b))
                .forEach((name) => {
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = name;
                    selG.appendChild(option);
                });
            if (glitch[curG]) selG.value = curG;
        }
    }
};

window.initializeSkinCreator = function() {
    console.log('Initializing Skin Creator...');
    SkinCreator.cleanup();
    SkinCreator.init();
    SkinCreator.initializeEventListeners();
    SkinCreator.updatePresetsDropdown();
    console.log('Skin Creator initialized successfully');
};