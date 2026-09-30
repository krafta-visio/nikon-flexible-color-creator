/**
 * Live Preview Engine for Nikon Flexible Color Creator
 * Uses WebGL Fragment Shader for 60fps real-time color processing.
 */

class FlexibleColorPreview {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;

        this.gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: true }) ||
                  this.canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });
        
        this.isComparing = false;
        this.splitCompare = false;
        this.splitPosition = 0.5;
        this.originalImage = null;
        this.currentImageUrl = '';
        this.lutTexture = null;
        this.imageTexture = null;
        this.isLoaded = false;
        this.imageCache = new Map();
        this.currentLoadingImg = null;
        this.lutData = new Uint8Array(256);
        for (let i = 0; i < 256; i++) this.lutData[i] = i;

        if (this.gl) {
            this.initWebGL();
        }
        this.initEvents();
    }

    initWebGL() {
        const gl = this.gl;

        const vsSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;

        const fsSource = `
            precision mediump float;
            varying vec2 v_texCoord;
            uniform sampler2D u_image;
            uniform sampler2D u_lut;
            uniform vec2 u_textureSize;

            uniform float u_contrast;
            uniform float u_highlights;
            uniform float u_shadows;
            uniform float u_whiteLevel;
            uniform float u_blackLevel;
            uniform float u_saturation;
            uniform float u_clarity;
            uniform float u_sharpen;
            uniform int u_useCustomCurve;

            // Color Blender (8 colors: R, O, Y, G, C, B, P, M)
            // Each vec3: (HueDelta in deg -180..180, SatDelta -100..100, LumDelta -100..100)
            uniform vec3 u_cbRed;
            uniform vec3 u_cbOrange;
            uniform vec3 u_cbYellow;
            uniform vec3 u_cbGreen;
            uniform vec3 u_cbCyan;
            uniform vec3 u_cbBlue;
            uniform vec3 u_cbPurple;
            uniform vec3 u_cbMagenta;

            // Color Grading (Shadow, Midtone, Highlight)
            // vec3: (Hue 0..360, Sat 0..100, Lum -100..100)
            uniform vec3 u_cgShadow;
            uniform vec3 u_cgMidtone;
            uniform vec3 u_cgHighlight;
            uniform float u_cgBlending;
            uniform float u_cgBalance;

            uniform int u_isComparing;
            uniform float u_splitPosition;
            uniform int u_splitEnabled;

            // HSL Conversion helpers
            vec3 rgb2hsl(vec3 c) {
                float cMin = min(c.r, min(c.g, c.b));
                float cMax = max(c.r, max(c.g, c.b));
                float delta = cMax - cMin;
                float l = (cMax + cMin) * 0.5;
                float s = 0.0;
                float h = 0.0;

                if (delta > 0.00001) {
                    s = l < 0.5 ? delta / (cMax + cMin) : delta / (2.0 - cMax - cMin);
                    if (c.r >= cMax) {
                        h = (c.g - c.b) / delta;
                        if (h < 0.0) h += 6.0;
                    } else if (c.g >= cMax) {
                        h = 2.0 + (c.b - c.r) / delta;
                    } else {
                        h = 4.0 + (c.r - c.g) / delta;
                    }
                    h *= 60.0;
                }
                return vec3(h, clamp(s, 0.0, 1.0), clamp(l, 0.0, 1.0));
            }

            float hue2rgb(float p, float q, float t) {
                if (t < 0.0) t += 1.0;
                if (t > 1.0) t -= 1.0;
                if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
                if (t < 1.0 / 2.0) return q;
                if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
                return p;
            }

            vec3 hsl2rgb(vec3 hsl) {
                float h = hsl.x / 360.0;
                float s = clamp(hsl.y, 0.0, 1.0);
                float l = clamp(hsl.z, 0.0, 1.0);
                if (s <= 0.00001) return vec3(l);

                float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
                float p = 2.0 * l - q;
                return vec3(
                    hue2rgb(p, q, h + 1.0 / 3.0),
                    hue2rgb(p, q, h),
                    hue2rgb(p, q, h - 1.0 / 3.0)
                );
            }

            float hueDist(float h1, float h2) {
                float d = abs(h1 - h2);
                return d > 180.0 ? 360.0 - d : d;
            }

            float getWeight(float hue, float targetHue, float span) {
                float d = hueDist(hue, targetHue);
                return clamp(1.0 - (d / span), 0.0, 1.0);
            }

            void main() {
                vec4 origColor = texture2D(u_image, v_texCoord);
                if (u_isComparing == 1 || (u_splitEnabled == 1 && v_texCoord.x < u_splitPosition)) {
                    gl_FragColor = origColor;
                    return;
                }

                vec3 col = origColor.rgb;

                // 1. Sharpening & Clarity (Spatial approximation)
                if (u_sharpen > 0.0 || abs(u_clarity) > 0.0) {
                    vec2 onePixel = vec2(1.0, 1.0) / u_textureSize;
                    vec3 blur = (
                        texture2D(u_image, v_texCoord + vec2(-onePixel.x, 0.0)).rgb +
                        texture2D(u_image, v_texCoord + vec2(onePixel.x, 0.0)).rgb +
                        texture2D(u_image, v_texCoord + vec2(0.0, -onePixel.y)).rgb +
                        texture2D(u_image, v_texCoord + vec2(0.0, onePixel.y)).rgb
                    ) * 0.25;

                    if (u_sharpen > 0.0) {
                        float sAmount = u_sharpen * 0.15;
                        col = clamp(col + (col - blur) * sAmount, 0.0, 1.0);
                    }
                    if (abs(u_clarity) > 0.0) {
                        float cAmount = u_clarity * 0.05;
                        col = clamp(col + (col - blur) * cAmount, 0.0, 1.0);
                    }
                }

                // 2. Color Blender (8 HSL Color Channels)
                vec3 hsl = rgb2hsl(col);
                if (hsl.y > 0.01) {
                    float wRed     = max(getWeight(hsl.x, 0.0, 35.0), getWeight(hsl.x, 360.0, 35.0));
                    float wOrange  = getWeight(hsl.x, 30.0, 30.0);
                    float wYellow  = getWeight(hsl.x, 60.0, 35.0);
                    float wGreen   = getWeight(hsl.x, 120.0, 45.0);
                    float wCyan    = getWeight(hsl.x, 180.0, 35.0);
                    float wBlue    = getWeight(hsl.x, 240.0, 40.0);
                    float wPurple  = getWeight(hsl.x, 280.0, 30.0);
                    float wMagenta = getWeight(hsl.x, 320.0, 35.0);

                    float totalW = wRed + wOrange + wYellow + wGreen + wCyan + wBlue + wPurple + wMagenta;
                    if (totalW > 0.0) {
                        vec3 delta = (
                            u_cbRed * wRed +
                            u_cbOrange * wOrange +
                            u_cbYellow * wYellow +
                            u_cbGreen * wGreen +
                            u_cbCyan * wCyan +
                            u_cbBlue * wBlue +
                            u_cbPurple * wPurple +
                            u_cbMagenta * wMagenta
                        ) / totalW;

                        hsl.x = mod(hsl.x + delta.x * (hsl.y), 360.0);
                        hsl.y = clamp(hsl.y * (1.0 + (delta.y / 100.0)), 0.0, 1.0);
                        hsl.z = clamp(hsl.z + (delta.z / 200.0) * hsl.y, 0.0, 1.0);
                        col = hsl2rgb(hsl);
                    }
                }

                // 3. Basic Tonal Adjustments (Highlights, Shadows, Whites, Blacks, Contrast)
                float lum = dot(col, vec3(0.299, 0.587, 0.114));

                // Shadows & Highlights
                if (abs(u_shadows) > 0.0) {
                    float sFactor = (1.0 - smoothstep(0.0, 0.65, lum)) * (u_shadows / 100.0) * 0.4;
                    col += col * sFactor;
                }
                if (abs(u_highlights) > 0.0) {
                    float hFactor = smoothstep(0.35, 1.0, lum) * (u_highlights / 100.0) * 0.4;
                    col += col * hFactor;
                }

                // Whites & Blacks
                if (abs(u_whiteLevel) > 0.0) {
                    float wFactor = smoothstep(0.6, 1.0, lum) * (u_whiteLevel / 100.0) * 0.25;
                    col += wFactor;
                }
                if (abs(u_blackLevel) > 0.0) {
                    float bFactor = (1.0 - smoothstep(0.0, 0.4, lum)) * (u_blackLevel / 100.0) * 0.25;
                    col += bFactor;
                }

                // Contrast
                if (abs(u_contrast) > 0.0) {
                    float cFactor = 1.0 + (u_contrast / 100.0) * 0.6;
                    col = (col - 0.5) * cFactor + 0.5;
                }
                col = clamp(col, 0.0, 1.0);

                // 4. Custom Tone Curve LUT
                if (u_useCustomCurve == 1) {
                    float r = texture2D(u_lut, vec2(col.r, 0.5)).r;
                    float g = texture2D(u_lut, vec2(col.g, 0.5)).r;
                    float b = texture2D(u_lut, vec2(col.b, 0.5)).r;
                    col = vec3(r, g, b);
                }

                // 5. Color Grading (3-Way Split Toning + Blending & Balance)
                float finalLum = dot(col, vec3(0.299, 0.587, 0.114));
                float balShift = (u_cgBalance / 100.0) * 0.25;
                float blendFactor = clamp(u_cgBlending / 100.0, 0.1, 0.9);

                float sWeight = 1.0 - smoothstep(0.0, 0.5 + balShift + (blendFactor * 0.2), finalLum);
                float hWeight = smoothstep(0.5 + balShift - (blendFactor * 0.2), 1.0, finalLum);
                float mWeight = clamp(1.0 - abs(finalLum - (0.5 + balShift)) * 2.5, 0.0, 1.0);

                // Apply Shadow Tint
                if (u_cgShadow.y > 0.0) {
                    vec3 sTint = hsl2rgb(vec3(u_cgShadow.x, 1.0, 0.5));
                    col = mix(col, col * sTint * 2.0, (u_cgShadow.y / 100.0) * sWeight * 0.5);
                }
                col += (u_cgShadow.z / 100.0) * sWeight * 0.2;

                // Apply Midtone Tint
                if (u_cgMidtone.y > 0.0) {
                    vec3 mTint = hsl2rgb(vec3(u_cgMidtone.x, 1.0, 0.5));
                    col = mix(col, col * mTint * 2.0, (u_cgMidtone.y / 100.0) * mWeight * 0.4);
                }
                col += (u_cgMidtone.z / 100.0) * mWeight * 0.2;

                // Apply Highlight Tint
                if (u_cgHighlight.y > 0.0) {
                    vec3 hTint = hsl2rgb(vec3(u_cgHighlight.x, 1.0, 0.5));
                    col = mix(col, 1.0 - (1.0 - col) * (1.0 - hTint * 0.5), (u_cgHighlight.y / 100.0) * hWeight * 0.5);
                }
                col += (u_cgHighlight.z / 100.0) * hWeight * 0.2;

                // 6. Global Saturation
                if (abs(u_saturation) > 0.0) {
                    vec3 hslFinal = rgb2hsl(col);
                    hslFinal.y = clamp(hslFinal.y * (1.0 + (u_saturation / 100.0)), 0.0, 1.0);
                    col = hsl2rgb(hslFinal);
                }

                // Render Split Line if enabled
                if (u_splitEnabled == 1 && abs(v_texCoord.x - u_splitPosition) < 0.002) {
                    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
                    return;
                }

                gl_FragColor = vec4(clamp(col, 0.0, 1.0), origColor.a);
            }
        `;

        this.program = this.createProgram(gl, vsSource, fsSource);
        if (!this.program) return;

        // Quad Buffer
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,  1, -1, -1,  1,
            -1,  1,  1, -1,  1,  1,
        ]), gl.STATIC_DRAW);

        const texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0, 1,  1, 1,  0, 0,
            0, 0,  1, 1,  1, 0,
        ]), gl.STATIC_DRAW);

        this.positionLocation = gl.getAttribLocation(this.program, "a_position");
        this.texCoordLocation = gl.getAttribLocation(this.program, "a_texCoord");

        gl.enableVertexAttribArray(this.positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.enableVertexAttribArray(this.texCoordLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0);

        // Textures
        this.imageTexture = gl.createTexture();
        this.lutTexture = gl.createTexture();

        // Texture Unit Locations
        this.uImageLocation = gl.getUniformLocation(this.program, "u_image");
        this.uLutLocation = gl.getUniformLocation(this.program, "u_lut");
    }

    createProgram(gl, vsSource, fsSource) {
        function createShader(gl, type, source) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error("Shader compile error: ", gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        }

        const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) return null;

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error("Program link error: ", gl.getProgramInfoLog(prog));
            return null;
        }
        return prog;
    }

    loadImage(src, imageName = '') {
        if (!src) return;

        // Show loading indicator
        $('#previewLoadingOverlay').removeClass('d-none');
        if (imageName) {
            $('#previewLoadingText').text(`Loading ${imageName}...`);
        } else {
            $('#previewLoadingText').text('Loading Image...');
        }

        // Check if image is already cached in memory
        if (this.imageCache.has(src)) {
            const cachedImg = this.imageCache.get(src);
            this.applyLoadedImage(cachedImg);
            $('#previewLoadingOverlay').addClass('d-none');
            return;
        }

        // Cancel previous pending load if switching rapidly
        if (this.currentLoadingImg) {
            this.currentLoadingImg.onload = null;
            this.currentLoadingImg.onerror = null;
            this.currentLoadingImg.src = "";
            this.currentLoadingImg = null;
        }

        const img = new Image();
        this.currentLoadingImg = img;
        img.crossOrigin = "anonymous";

        img.onload = () => {
            if (this.currentLoadingImg !== img) return; // Stale request
            this.imageCache.set(src, img);
            this.applyLoadedImage(img);
            this.currentLoadingImg = null;
            $('#previewLoadingOverlay').addClass('d-none');
        };

        img.onerror = () => {
            if (this.currentLoadingImg !== img) return;
            console.warn("Failed to load image from URL, falling back to test chart.");
            this.generateFallbackSampleImage();
            this.currentLoadingImg = null;
            $('#previewLoadingOverlay').addClass('d-none');
        };

        img.src = src;
    }

    applyLoadedImage(img) {
        this.originalImage = img;
        this.canvas.width = img.width > 1200 ? 1200 : img.width;
        this.canvas.height = Math.round(this.canvas.width * (img.height / img.width));
        
        if (this.gl) {
            const gl = this.gl;
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        }
        this.isLoaded = true;
        this.render();
    }

    generateFallbackSampleImage() {
        const offCanvas = document.createElement('canvas');
        offCanvas.width = 800;
        offCanvas.height = 600;
        const ctx = offCanvas.getContext('2d');

        // Draw rich gradient background + portrait placeholder + color patches
        const grad = ctx.createLinearGradient(0, 0, 800, 600);
        grad.addColorStop(0, '#2c3e50');
        grad.addColorStop(0.5, '#4ca1af');
        grad.addColorStop(1, '#c4e0e5');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 800, 600);

        // Draw color blocks (Red, Orange, Yellow, Green, Cyan, Blue, Purple, Magenta)
        const colors = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e91e63'];
        colors.forEach((c, idx) => {
            ctx.fillStyle = c;
            ctx.fillRect(50 + idx * 85, 450, 75, 60);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText(c, 55 + idx * 85, 530);
        });

        // Grayscale ramp
        for (let i = 0; i < 10; i++) {
            const val = Math.round(i * 25.5);
            ctx.fillStyle = `rgb(${val},${val},${val})`;
            ctx.fillRect(50 + i * 70, 360, 65, 50);
        }

        // Draw portrait-like shapes
        ctx.fillStyle = '#f5d6ba'; // Skin tone
        ctx.beginPath();
        ctx.arc(400, 180, 90, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#4a2f13'; // Hair
        ctx.beginPath();
        ctx.arc(400, 140, 95, Math.PI, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#2c3e50';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Nikon Flexible Color Live Preview Test Chart', 400, 50);

        this.applyLoadedImage(offCanvas);
    }

    updateCurveLut(curveControlPoints) {
        // Monotone cubic interpolation for 256 values
        const points = (curveControlPoints && curveControlPoints.length >= 2) ? 
                       [...curveControlPoints].sort((a,b) => a.x - b.x) : 
                       [{x:0, y:0}, {x:255, y:255}];

        const lut = new Uint8Array(256);
        for (let x = 0; x < 256; x++) {
            let yVal = x;
            if (x <= points[0].x) {
                yVal = points[0].y;
            } else if (x >= points[points.length - 1].x) {
                yVal = points[points.length - 1].y;
            } else {
                for (let i = 0; i < points.length - 1; i++) {
                    if (x >= points[i].x && x <= points[i + 1].x) {
                        const t = (x - points[i].x) / (points[i + 1].x - points[i].x);
                        // smoothstep hermite
                        const smoothT = t * t * (3 - 2 * t);
                        yVal = points[i].y + smoothT * (points[i + 1].y - points[i].y);
                        break;
                    }
                }
            }
            lut[x] = Math.max(0, Math.min(255, Math.round(yVal)));
        }

        this.lutData = lut;

        if (this.gl) {
            const gl = this.gl;
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 256, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.lutData);
        }
    }

    render() {
        if (!this.gl || !this.isLoaded || !this.program) return;

        const gl = this.gl;
        gl.useProgram(this.program);

        // Bind image texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
        gl.uniform1i(this.uImageLocation, 0);

        // Bind LUT texture
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
        gl.uniform1i(this.uLutLocation, 1);

        // Dimensions
        gl.uniform2f(gl.getUniformLocation(this.program, "u_textureSize"), this.canvas.width, this.canvas.height);

        // Compare state
        gl.uniform1i(gl.getUniformLocation(this.program, "u_isComparing"), this.isComparing ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(this.program, "u_splitEnabled"), this.splitCompare ? 1 : 0);
        gl.uniform1f(gl.getUniformLocation(this.program, "u_splitPosition"), this.splitPosition);

        // Read UI Values
        const val = id => parseFloat($(id).val() || 0);
        const isCustomCurve = $('#useCustomCurves').prop('checked') ? 1 : 0;

        gl.uniform1i(gl.getUniformLocation(this.program, "u_useCustomCurve"), isCustomCurve);
        gl.uniform1f(gl.getUniformLocation(this.program, "u_contrast"), isCustomCurve ? 0 : val('#bsContrast'));
        gl.uniform1f(gl.getUniformLocation(this.program, "u_highlights"), isCustomCurve ? 0 : val('#bsHighlight'));
        gl.uniform1f(gl.getUniformLocation(this.program, "u_shadows"), isCustomCurve ? 0 : val('#bsShadow'));
        gl.uniform1f(gl.getUniformLocation(this.program, "u_whiteLevel"), isCustomCurve ? 0 : val('#bsWhite'));
        gl.uniform1f(gl.getUniformLocation(this.program, "u_blackLevel"), isCustomCurve ? 0 : val('#bsBlack'));
        gl.uniform1f(gl.getUniformLocation(this.program, "u_saturation"), val('#bsSaturation'));
        gl.uniform1f(gl.getUniformLocation(this.program, "u_clarity"), val('#bsClarity'));
        gl.uniform1f(gl.getUniformLocation(this.program, "u_sharpen"), val('#bsSharpen'));

        // Color Blender 8 Channels
        const cbUniform = (uName, prefix) => {
            gl.uniform3f(gl.getUniformLocation(this.program, uName),
                val(`#cmHue${prefix}`),
                val(`#cmSat${prefix}`),
                val(`#cmLum${prefix}`)
            );
        };
        cbUniform("u_cbRed", "Red");
        cbUniform("u_cbOrange", "Orange");
        cbUniform("u_cbYellow", "Yellow");
        cbUniform("u_cbGreen", "Green");
        cbUniform("u_cbCyan", "Cyan");
        cbUniform("u_cbBlue", "Blue");
        cbUniform("u_cbPurple", "Purple");
        cbUniform("u_cbMagenta", "Magenta");

        // Color Grading 3-Way
        gl.uniform3f(gl.getUniformLocation(this.program, "u_cgShadow"),
            val('#cgHueShadow'), val('#cgSatShadow'), val('#cgLumShadow'));
        gl.uniform3f(gl.getUniformLocation(this.program, "u_cgMidtone"),
            val('#cgHueMidtone'), val('#cgSatMidtone'), val('#cgLumMidtone'));
        gl.uniform3f(gl.getUniformLocation(this.program, "u_cgHighlight"),
            val('#cgHueHighlight'), val('#cgSatHighlight'), val('#cgLumHighlight'));

        gl.uniform1f(gl.getUniformLocation(this.program, "u_cgBlending"), val('#cgBlending') || 50);
        gl.uniform1f(gl.getUniformLocation(this.program, "u_cgBalance"), val('#cgBalance') || 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    initEvents() {
        // Split compare mouse drag
        let isDraggingSplit = false;
        const updateSplit = (e) => {
            if (!this.splitCompare) return;
            const rect = this.canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const x = (clientX - rect.left) / rect.width;
            this.splitPosition = Math.max(0.02, Math.min(0.98, x));
            this.render();
        };

        this.canvas.addEventListener('mousedown', (e) => {
            if (this.splitCompare) {
                isDraggingSplit = true;
                updateSplit(e);
            }
        });
        window.addEventListener('mousemove', (e) => {
            if (isDraggingSplit) updateSplit(e);
        });
        window.addEventListener('mouseup', () => {
            isDraggingSplit = false;
        });

        this.canvas.addEventListener('touchstart', (e) => {
            if (this.splitCompare) {
                isDraggingSplit = true;
                updateSplit(e);
            }
        });
        window.addEventListener('touchmove', (e) => {
            if (isDraggingSplit) updateSplit(e);
        });
        window.addEventListener('touchend', () => {
            isDraggingSplit = false;
        });
    }
}

// Global instance
window.fcPreview = null;

const UNSPLASH_SAMPLES = [
    {
        category: "Portraits & Skin Tones",
        photos: [
            { name: "Female Portrait (Natural Light)", url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1000&q=80" },
            { name: "Male Portrait (Studio Lighting)", url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=1000&q=80" },
            { name: "Golden Hour Glow Portrait", url: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=1000&q=80" },
            { name: "Fashion & Soft Skin Tones", url: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1000&q=80" },
            { name: "Moody Dramatic Portrait", url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=1000&q=80" },
            { name: "Outdoor Sunlit Smile", url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=1000&q=80" }
        ]
    },
    {
        category: "Landscape & Nature",
        photos: [
            { name: "Alpine Mountain & Turquoise Lake", url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1000&q=80" },
            { name: "Misty Pine Forest & Fog", url: "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1000&q=80" },
            { name: "Tropical Coast & Blue Ocean", url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1000&q=80" },
            { name: "Autumn Foliage & Golden Trees", url: "https://images.unsplash.com/photo-1477414348463-c0eb7f1359b6?auto=format&fit=crop&w=1000&q=80" },
            { name: "Iceland Dramatic Waterfall", url: "https://images.unsplash.com/photo-1433086966358-54859d0ed716?auto=format&fit=crop&w=1000&q=80" },
            { name: "Rolling Green Hills Sunset", url: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1000&q=80" }
        ]
    },
    {
        category: "Street & Urban",
        photos: [
            { name: "Tokyo City Night & Cyber Neon", url: "https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=1000&q=80" },
            { name: "Rainy European Street & Reflections", url: "https://images.unsplash.com/photo-1477959858617-67f30bc75b82?auto=format&fit=crop&w=1000&q=80" },
            { name: "Vintage Classic Car at Sunset", url: "https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&w=1000&q=80" },
            { name: "Modern Glass Architecture", url: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1000&q=80" },
            { name: "New York Street & Shadows", url: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1000&q=80" }
        ]
    },
    {
        category: "Cinematic & Moody",
        photos: [
            { name: "Desert Sand Dunes & Warm Sunset", url: "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=1000&q=80" },
            { name: "Winding Mountain Highway Fog", url: "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=1000&q=80" },
            { name: "Cozy Warm Cafe & Coffee", url: "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=1000&q=80" },
            { name: "Sunset Sky & Horizon", url: "https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?auto=format&fit=crop&w=1000&q=80" }
        ]
    }
];

$(document).ready(function() {
    window.fcPreview = new FlexibleColorPreview('previewCanvas');

    // Populate dropdown with categorized Unsplash sample images
    const select = $('#sampleImageSelect');
    select.empty();

    let firstPhoto = null;

    UNSPLASH_SAMPLES.forEach((group, gIdx) => {
        const optgroup = $(`<optgroup label="── ${group.category} ──"></optgroup>`);
        group.photos.forEach((photo, pIdx) => {
            if (gIdx === 0 && pIdx === 0) {
                firstPhoto = photo;
                optgroup.append(`<option value="${photo.url}" data-name="${photo.name}" selected>${photo.name}</option>`);
            } else {
                optgroup.append(`<option value="${photo.url}" data-name="${photo.name}">${photo.name}</option>`);
            }
        });
        select.append(optgroup);
    });

    // Automatically load the first photo by default on page start
    if (firstPhoto) {
        window.fcPreview.loadImage(firstPhoto.url, firstPhoto.name);
    } else {
        window.fcPreview.generateFallbackSampleImage();
    }

    // Load photo when user changes selection
    $('#sampleImageSelect').on('change', function() {
        const selectedOption = $(this).find('option:selected');
        const url = selectedOption.val();
        const name = selectedOption.data('name') || selectedOption.text();
        if (url) {
            window.fcPreview.loadImage(url, name);
        }
    });

    // Custom image upload
    $('#customImageInput').on('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(evt) {
                window.fcPreview.loadImage(evt.target.result, file.name);
            };
            reader.readAsDataURL(file);
        }
    });

    // Hold to compare (Before / After)
    $('#btnCompareOriginal')
        .on('mousedown touchstart', function() {
            if (window.fcPreview) {
                window.fcPreview.isComparing = true;
                window.fcPreview.render();
                $(this).addClass('active');
            }
        })
        .on('mouseup mouseleave touchend', function() {
            if (window.fcPreview) {
                window.fcPreview.isComparing = false;
                window.fcPreview.render();
                $(this).removeClass('active');
            }
        });

    // Split Compare Toggle
    $('#btnSplitCompare').on('click', function() {
        if (window.fcPreview) {
            window.fcPreview.splitCompare = !window.fcPreview.splitCompare;
            $(this).toggleClass('active btn-outline-warning btn-warning');
            window.fcPreview.render();
        }
    });

    // Hook all range sliders and checkboxes to re-render preview
    $('.range-input, #useCustomCurves').on('input change', function() {
        if (window.fcPreview) {
            window.fcPreview.render();
        }
    });
});

