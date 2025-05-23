import * as THREE from 'three';

// Define EulerOrder type based on Three.js documentation
export type EulerOrder = 'XYZ' | 'YZX' | 'ZXY' | 'XZY' | 'YXZ' | 'ZYX';

// Define InitialPoseData type
export interface InitialPoseData {
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    scale: THREE.Vector3;
}

// Define and export the default fight stance targets
// ONLY include bones that should actively change for the stance.
// Other bones will retain their initial pose.
export const defaultFightStanceTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }> = {
    // Using the values from CharacterViewer.tsx
    // Arms (Order: XYZ)
    'L_Upperarm': { rotation: { x: -6, y: -44, z: -76 }, eulerOrder: 'XYZ' as EulerOrder },
    'L_Forearm':  { rotation: { x: 102, y: -22, z: -34 }, eulerOrder: 'XYZ' as EulerOrder },
    'R_Upperarm': { rotation: { x: -51, y: 32, z: 107 }, eulerOrder: 'XYZ' as EulerOrder },
    'R_Forearm':  { rotation: { x: 51, y: 13, z: 72 }, eulerOrder: 'XYZ' as EulerOrder },
    // Legs (Order: YXZ) - REVERTED TO ORIGINAL VALUES
    'L_Thigh':    { rotation: { x: 2, y: 180, z: -173 }, eulerOrder: 'YXZ' as EulerOrder }, 
    'L_Calf':     { rotation: { x: -6, y: 11, z: -9 }, eulerOrder: 'YXZ' as EulerOrder }, 
    'R_Thigh':    { rotation: { x: 30, y: 166, z: 167 }, eulerOrder: 'YXZ' as EulerOrder }, 
    'R_Calf':     { rotation: { x: 5, y: -21, z: -2 }, eulerOrder: 'YXZ' as EulerOrder }, 
    // Removed Hand, Clavicle, Foot, Pelvis, Waist, Spine, Head defaults
};

/**
 * Creates an animation clip to transition from the initial pose to a target fight stance.
 */
export function createFightStanceClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, InitialPoseData>, 
    boneTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }>, 
    clipName: string = 'FightStance', 
    duration: number = 0.5
): THREE.AnimationClip | null { 
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn("[createFightStanceClip] Missing skeleton or initial pose.");
        return null;
    }
    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration];
    const deg = THREE.MathUtils.degToRad;
    // console.log(`--- Creating Clip: ${clipName} ---`);
    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const targetInfo = boneTargets[boneName];
        const initial = initialPose[boneName];
        if (!initial) return; // Skip bone if no initial data
        
        const startQuat: THREE.Quaternion = initial.quat;
        let endQuat = startQuat.clone();
        
        if (targetInfo?.rotation) {
            const eulerOrder = targetInfo.eulerOrder || 'XYZ';
            const r = targetInfo.rotation;
            const initialEuler = new THREE.Euler().setFromQuaternion(startQuat, eulerOrder);
            const endEulerRad = new THREE.Euler(
                deg(r.x ?? THREE.MathUtils.radToDeg(initialEuler.x)),
                deg(r.y ?? THREE.MathUtils.radToDeg(initialEuler.y)),
                deg(r.z ?? THREE.MathUtils.radToDeg(initialEuler.z)),
                eulerOrder
            );
            endQuat.setFromEuler(endEulerRad);
        }
        
        // Only add track if a target was specified for this bone, or if end is different
        if (targetInfo || !endQuat.equals(startQuat)) {
            tracks.push(new THREE.QuaternionKeyframeTrack(
                `${boneName}.quaternion`, 
                times, 
                [startQuat.x, startQuat.y, startQuat.z, startQuat.w, endQuat.x, endQuat.y, endQuat.z, endQuat.w]
            ));
        }
    });
    
    if (tracks.length === 0) { console.warn(`[createFightStanceClip] No tracks generated for ${clipName}.`); return null; }
    return new THREE.AnimationClip(clipName, duration, tracks);
}

/**
 * Creates an animation clip to transition from the current pose back to the initial pose.
 */
export function createResetPoseClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, InitialPoseData>, 
    duration: number = 0.3
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0) {
         console.warn("[createResetPoseClip] Missing skeleton or initial pose.");
        return null;
    }
    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration];
    let trackAdded = false; // Flag to ensure at least one track

    skeleton.bones.forEach((bone: THREE.Bone) => {
        const initial = initialPose[bone.name];
        if (!initial) return;
        const currentQuat = bone.quaternion;
        
        // Add track if current differs from initial
        if (!currentQuat.equals(initial.quat)) {
            tracks.push(new THREE.QuaternionKeyframeTrack(
                `${bone.name}.quaternion`, 
                times, 
                [currentQuat.x, currentQuat.y, currentQuat.z, currentQuat.w, initial.quat.x, initial.quat.y, initial.quat.z, initial.quat.w]
            ));
            trackAdded = true;
        }
    });

    // Ensure at least one track exists, even if it does nothing, to prevent returning null
    if (!trackAdded) {
        const hipBone = skeleton.bones.find(b => b.name === 'Hip');
        const initialHip = hipBone ? initialPose[hipBone.name] : null;
        if (hipBone && initialHip) {
             tracks.push(new THREE.QuaternionKeyframeTrack(
                 `${hipBone.name}.quaternion`, 
                 times, 
                 [initialHip.quat.x, initialHip.quat.y, initialHip.quat.z, initialHip.quat.w, initialHip.quat.x, initialHip.quat.y, initialHip.quat.z, initialHip.quat.w]
             ));
            console.log("[createResetPoseClip] Pose matched initial, adding dummy Hip track.")
        } else {
            // Fallback if Hip bone isn't found or has no initial pose (shouldn't happen ideally)
            console.warn("[createResetPoseClip] Could not add dummy track as Hip bone/pose was missing.")
            return null; // Return null only in this unlikely fallback case
        }
    }
    
    return new THREE.AnimationClip('ResetPose', duration, tracks);
}

/**
 * Creates a looping idle breathing animation centered around a target stance pose.
 */
export function createIdleBreathClip(
    skeleton: THREE.Skeleton | null, 
    stancePoseTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }>, 
    initialPose: Record<string, InitialPoseData>, 
    clipName: string = 'IdleBreath', 
    duration: number = 2.5, 
    intensity: number = 1.7 
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(stancePoseTargets).length === 0 || Object.keys(initialPose).length === 0) {
        console.warn("[createIdleBreathClip] Missing skeleton, stance targets, or initial pose.");
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration / 2, duration]; 
    const deg = THREE.MathUtils.degToRad;

    const breathingBones = ['Spine01', 'Spine02', 'Head', 'L_Clavicle', 'R_Clavicle', 'L_Upperarm', 'R_Upperarm']; 

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const stanceInfo = stancePoseTargets[boneName];
        const initial = initialPose[boneName];
        
        let baseQuat = new THREE.Quaternion();
        if (stanceInfo?.rotation && stanceInfo.eulerOrder && initial) {
            const eulerOrder = stanceInfo.eulerOrder;
            const r = stanceInfo.rotation;
            const stanceEulerRad = new THREE.Euler(deg(r.x ?? 0), deg(r.y ?? 0), deg(r.z ?? 0), eulerOrder);
            baseQuat.setFromEuler(stanceEulerRad);
        } else if (initial) {
            baseQuat.copy(initial.quat); 
        } else {
            return; 
        }

        if (breathingBones.includes(boneName)) {
            const peakQuat = new THREE.Quaternion(); // Initialize peakQuat
            const deltaEuler = new THREE.Euler();
            const deltaIntensityRad = deg(intensity);

            if (boneName.includes('Spine')) {
                deltaEuler.x = -deltaIntensityRad;
            } else if (boneName.includes('Clavicle')) {
                deltaEuler.y = boneName.startsWith('L_') ? deltaIntensityRad * 0.5 : -deltaIntensityRad * 0.5;
            } else if (boneName.includes('Head')) {
                deltaEuler.x = -deltaIntensityRad * 0.5;
            } else if (boneName.includes('Upperarm')) {
                deltaEuler.z = boneName.startsWith('L_') ? -deltaIntensityRad * 0.3 : deltaIntensityRad * 0.3; 
            }
            
            const deltaQuat = new THREE.Quaternion().setFromEuler(deltaEuler);
            peakQuat.multiplyQuaternions(baseQuat, deltaQuat); // Calculate peak based on base

            tracks.push(new THREE.QuaternionKeyframeTrack(
                `${boneName}.quaternion`, 
                times, 
                [
                    baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w, 
                    peakQuat.x, peakQuat.y, peakQuat.z, peakQuat.w, 
                    baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w
                ]
            ));
        } else {
            // Keep non-breathing bones static at the stance pose
            tracks.push(new THREE.QuaternionKeyframeTrack(
                `${boneName}.quaternion`, 
                [0], 
                [baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w]
            ));
        }
    });

    if (tracks.length === 0) { console.warn(`[createIdleBreathClip] No tracks generated for ${clipName}.`); return null; }
    return new THREE.AnimationClip(clipName, duration, tracks);
} 

/**
 * Creates a looping walk cycle animation.
 * Upper body attempts to hold the stance pose.
 * Legs perform a basic walk cycle.
 */
export function createWalkCycleClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, InitialPoseData>, 
    stancePoseTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }>, 
    clipName: string = 'WalkCycle', 
    duration: number = 1.0, // Duration for one full cycle (two steps)
    stepHeight: number = 5, // How much the thigh lifts vertically on Z axis (degrees)
    strideLength: number = 25, // How far forward/back the thigh swings on X axis (degrees)
    spineTwist: number = 8 // How much the spine twists on Y axis (degrees)
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn("[createWalkCycleClip] Missing skeleton or initial pose.");
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    // Keyframes: 0 = Start, 0.25 = Left leg passing, 0.5 = Left leg forward, 0.75 = Right leg passing, 1.0 = Right leg forward (back to start)
    const times = [0, duration * 0.25, duration * 0.5, duration * 0.75, duration];
    const deg = THREE.MathUtils.degToRad;
    const tmpEuler = new THREE.Euler();
    const tmpQuat = new THREE.Quaternion();

    // Bones groups
    const legBones = ['L_Thigh', 'L_Calf', 'L_Foot', 'R_Thigh', 'R_Calf', 'R_Foot'];
    const spineBone = 'Spine01'; // Target for torso twist
    // Assume all other bones are upper body/head/spine etc.

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const initial = initialPose[boneName];
        if (!initial) return; // Skip bones without initial data

        const stanceInfo = stancePoseTargets[boneName];
        let baseQuat = new THREE.Quaternion(); // Base pose for the bone

        // Determine the base pose (Stance for upper body, Initial for legs - walk modifies from initial)
        if (!legBones.includes(boneName) && stanceInfo?.rotation && stanceInfo.eulerOrder) {
             // Use stance pose for upper body
             tmpEuler.set(deg(stanceInfo.rotation.x ?? 0), deg(stanceInfo.rotation.y ?? 0), deg(stanceInfo.rotation.z ?? 0), stanceInfo.eulerOrder);
             baseQuat.setFromEuler(tmpEuler);
        } else {
            // Use initial pose for legs (or upper body parts not in stance)
            baseQuat.copy(initial.quat);
        }

        // --- Define Keyframe Values --- 
        const values: number[] = [];

        if (legBones.includes(boneName)) {
            // --- Leg Animation --- 
            const isLeft = boneName.startsWith('L_');
            const baseEuler = new THREE.Euler().setFromQuaternion(baseQuat, 'YXZ'); // Use YXZ for legs

            // Calculate keyframe rotations relative to the base pose
            for (let i = 0; i < times.length; i++) {
                const phase = (times[i] / duration) * 2 * Math.PI; // Full cycle phase
                let angleX = baseEuler.x;
                let angleY = baseEuler.y; // Keep base Y rotation
                let angleZ = baseEuler.z; // Keep base Z rotation (usually for twist)

                if (boneName.includes('Thigh')) {
                    // Thigh swing (cosine wave for forward/back)
                    angleX += deg(strideLength * Math.cos(phase + (isLeft ? 0 : Math.PI)) * -1);
                    // Slight lift during passing phase (sine wave, positive only)
                    angleZ += deg(stepHeight * Math.max(0, Math.sin(phase + (isLeft ? 0 : Math.PI) + Math.PI * 0.5)));
                }
                else if (boneName.includes('Calf')) {
                     // Calf bends significantly when leg is back, less when forward
                     // Using cosine: bends most when cos is near 1 (leg back), less when near -1 (leg fwd)
                     const calfBend = deg(45 * (Math.cos(phase + (isLeft ? 0 : Math.PI)) + 1) / 2); // Max bend 45 deg
                     angleX -= calfBend; // Subtract to bend knee backward
                }
                else if (boneName.includes('Foot')) {
                     // Foot points down (plantarflex) when leg back, lifts (dorsiflex) when leg forward
                     const footAngle = deg(25 * Math.cos(phase + (isLeft ? 0 : Math.PI)) * -1); 
                     angleX += footAngle;
                }
                 else { angleX = baseEuler.x; }

                // Convert back to Quaternion
                tmpEuler.set(angleX, angleY, angleZ, 'YXZ');
                tmpQuat.setFromEuler(tmpEuler);
                values.push(tmpQuat.x, tmpQuat.y, tmpQuat.z, tmpQuat.w);
            }
             tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values));

        } else if (boneName === spineBone) {
            // --- Spine Animation --- 
            const baseEuler = new THREE.Euler().setFromQuaternion(baseQuat, 'XYZ'); // Use XYZ for spine
            for (let i = 0; i < times.length; i++) {
                const phase = (times[i] / duration) * 2 * Math.PI;
                // Rotate Y opposite to the leading leg (use sine wave)
                const twist = deg(spineTwist * Math.sin(phase)); // Left leg leads first half
                tmpEuler.set(baseEuler.x, baseEuler.y + twist, baseEuler.z, 'XYZ');
                tmpQuat.setFromEuler(tmpEuler);
                values.push(tmpQuat.x, tmpQuat.y, tmpQuat.z, tmpQuat.w);
            }
            tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values));

        } else {
            // --- Upper Body (Static Stance) --- 
             // Keep upper body static at base (stance) pose
             for (let i = 0; i < times.length; i++) {
                 values.push(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w);
             }
             tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values));
        }
    });

    if (tracks.length === 0) { console.warn(`[createWalkCycleClip] No tracks generated for ${clipName}.`); return null; }
    // Set loop property on the clip itself? No, handled by action.
    return new THREE.AnimationClip(clipName, duration, tracks);
} 

// Define a type for the optional start pose data
export type StartPose = Record<string, { quat: THREE.Quaternion }>;

/**
 * Creates a right punch animation.
 * Starts from a provided startPose (or current if null), locks non-essential bones, returns arms to stance/initial.
 */
export function createRightPunchClip(
    skeleton: THREE.Skeleton | null,
    initialPose: Record<string, InitialPoseData>,
    stancePoseTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }>, 
    startPose: StartPose | null = null, // <-- ADDED ARGUMENT
    clipName: string = 'RightPunch',
    duration: number = 0.6 
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn("[createRightPunchClip] Missing skeleton or initial pose.");
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    // Define timings for the 4 keyframes
    const prepTime = duration * 0.1;
    const apexTime = duration * 0.35;
    const times = [0, prepTime, apexTime, duration]; // Start, Prep, Apex, End

    const deg = THREE.MathUtils.degToRad;
    const tmpEuler = new THREE.Euler();
    const tmpQuat = new THREE.Quaternion();
    // No longer need tmpQuat2

    // Key bones involved
    const punchArm = ['R_Upperarm', 'R_Forearm', 'R_Hand'];
    const guardArm = ['L_Upperarm', 'L_Forearm', 'L_Hand'];
    const torsoBones = ['Pelvis', 'Spine01', 'Spine02']; // Include Pelvis for twist propagation if needed
    const headBone = 'Head';
    const rightLegBones = ['R_Thigh', 'R_Calf', 'R_Foot'];
    const leftLegBones = ['L_Thigh', 'L_Calf', 'L_Foot'];
    const legBones = [...rightLegBones, ...leftLegBones];

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const initial = initialPose[boneName];
        if (!initial) return;

        // --- Get STARTING pose --- 
        let currentQuat: THREE.Quaternion;
        if (startPose && startPose[boneName]) {
            currentQuat = startPose[boneName].quat.clone(); // Use passed start pose
        } else {
            console.warn(`[createRightPunchClip] Start pose not found for ${boneName}, using live skeleton pose.`);
            currentQuat = bone.quaternion.clone(); // Fallback to live pose
        }
        
        // Determine a suitable Euler order
        let eulerOrder: EulerOrder = 'XYZ';
        const stanceInfo = stancePoseTargets[boneName];
        if (stanceInfo?.rotation && stanceInfo.eulerOrder) {
            eulerOrder = stanceInfo.eulerOrder;
        } else if (punchArm.includes(boneName) || guardArm.includes(boneName)) {
            eulerOrder = 'XYZ';
        } else if (legBones.includes(boneName)) { // Correctly check combined legBones
            eulerOrder = 'YXZ';
        } // Default 'XYZ' for others
        const currentEuler = new THREE.Euler().setFromQuaternion(currentQuat, eulerOrder);

        // --- Determine TARGET Stance/Initial pose (only used for Arms' Frame 3) ---
        let targetEndQuat = new THREE.Quaternion();
        if (stanceInfo?.rotation && stanceInfo.eulerOrder) {
             tmpEuler.set(deg(stanceInfo.rotation.x ?? 0), deg(stanceInfo.rotation.y ?? 0), deg(stanceInfo.rotation.z ?? 0), stanceInfo.eulerOrder);
             targetEndQuat.setFromEuler(tmpEuler);
        } else {
            targetEndQuat.copy(initial.quat);
        }

        const keyframeValues: number[] = [];

        // --- Calculate Keyframes ---

        if (legBones.includes(boneName)) {
            // --- LOCK Leg Bones ---
            // Force all keyframes to the starting pose
            const quat = currentQuat;
            keyframeValues.push(quat.x, quat.y, quat.z, quat.w); // Frame 0
            keyframeValues.push(quat.x, quat.y, quat.z, quat.w); // Frame 1 (Prep)
            keyframeValues.push(quat.x, quat.y, quat.z, quat.w); // Frame 2 (Apex)
            keyframeValues.push(quat.x, quat.y, quat.z, quat.w); // Frame 3 (End)
        } else {
            // --- Animate Other Bones ---

            // Determine the final pose for non-leg bones
            let finalQuat = new THREE.Quaternion();
            const shouldReturnToStance = punchArm.includes(boneName) || guardArm.includes(boneName);
            if (shouldReturnToStance) {
                finalQuat.copy(targetEndQuat); // Arms return to stance/initial
            } else {
                finalQuat.copy(currentQuat); // Torso, Head etc. return to current start pose
            }

            // Frame 0 (time 0): CURRENT Pose
            keyframeValues.push(currentQuat.x, currentQuat.y, currentQuat.z, currentQuat.w);

            // Frame 1 (time prepTime): Preparatory Pose
            let prepQuat = new THREE.Quaternion();
            if (punchArm.includes(boneName)) {
                // Calculate prep RELATIVE to current for punching arm
                let prepEuler = new THREE.Euler().copy(currentEuler);
                if (boneName === 'R_Upperarm') {
                     prepEuler.x += deg(5);
                     prepEuler.z += deg(15);
                 }
                 else if (boneName === 'R_Forearm') {
                     prepEuler.z += deg(60);
                 }
                 else if (boneName === 'R_Hand') {
                     prepEuler.z += deg(10);
                 }
                 prepQuat.setFromEuler(prepEuler.reorder(eulerOrder));
            } else {
                 // Other non-leg bones (Guard Arm, Torso, Head): HOLD current pose for prep frame
                 prepQuat.copy(currentQuat);
            }
            keyframeValues.push(prepQuat.x, prepQuat.y, prepQuat.z, prepQuat.w);

            // Frame 2 (time apexTime): Punch Apex
            let apexQuat = new THREE.Quaternion();
            if (punchArm.includes(boneName)) {
                // --- Use ABSOLUTE targets for punch arm ---
                if (boneName === 'R_Upperarm') { tmpEuler.set(deg(-20), deg(78), deg(38), 'XYZ'); }
                else if (boneName === 'R_Forearm') { tmpEuler.set(deg(95), deg(-92), deg(95), 'XYZ'); }
                else if (boneName === 'R_Hand') { tmpEuler.set(deg(-10), deg(50), deg(-10), 'XYZ'); }
                 apexQuat.setFromEuler(tmpEuler.reorder('XYZ'));

            } else if (guardArm.includes(boneName)) {
                // --- Use ABSOLUTE targets for guard arm ---
                 if (boneName === 'L_Upperarm') { tmpEuler.set(deg(15), deg(-40), deg(-72), 'XYZ'); }
                 else if (boneName === 'L_Forearm') { tmpEuler.set(deg(173), deg(66), deg(-55), 'XYZ'); }
                 else if (boneName === 'L_Hand') { tmpEuler.set(deg(0), deg(0), deg(0), 'XYZ'); }
                apexQuat.setFromEuler(tmpEuler.reorder('XYZ'));

            } else if (torsoBones.includes(boneName)) {
                // Rotate torso RELATIVE to current pose
                tmpEuler.copy(currentEuler);
                if (boneName.includes('Spine01')) tmpEuler.y += deg(70); // Apply twist relative to current Y
                if (boneName.includes('Spine')) tmpEuler.x += deg(5); // Apply lean relative to current X
                apexQuat.setFromEuler(tmpEuler.reorder(eulerOrder));

            } else {
                 // Other non-leg/non-arm/non-torso bones (Head etc.): HOLD current pose during apex
                 apexQuat.copy(currentQuat);
            }
            keyframeValues.push(apexQuat.x, apexQuat.y, apexQuat.z, apexQuat.w);

            // Frame 3 (time duration): Return towards determined final pose
            keyframeValues.push(finalQuat.x, finalQuat.y, finalQuat.z, finalQuat.w);
        }

        // Add track for this bone
        tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, keyframeValues));
    });

    if (tracks.length === 0) { console.warn(`[createRightPunchClip] No tracks generated for ${clipName}.`); return null; }
    return new THREE.AnimationClip(clipName, duration, tracks);
}

// Define and export target rotations for the block pose
export const blockTargets: Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }> = {
    // Values directly from Leva screenshot
    'L_Upperarm': { rotation: { x: -15, y: -85, z: -68 }, eulerOrder: 'XYZ' },
    'L_Forearm':  { rotation: { x: 0, y: -5, z: -95 }, eulerOrder: 'XYZ' },
    'L_Hand':     { rotation: { x: 0, y: -13, z: 0 }, eulerOrder: 'XYZ' },
    'R_Upperarm': { rotation: { x: 112, y: 41, z: -15 }, eulerOrder: 'XYZ' },
    'R_Forearm':  { rotation: { x: 138, y: 69, z: -95 }, eulerOrder: 'XYZ' },
    'R_Hand':     { rotation: { x: 0, y: 0, z: 0 }, eulerOrder: 'XYZ' },
};

/**
 * Creates a transition animation to a blocking pose.
 * Starts from stance, moves arms to block, holds.
 */
export function createBlockPoseClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, InitialPoseData>, 
    stancePoseTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }>, 
    clipName: string = 'BlockPose', 
    duration: number = 0.3 // Duration to transition into the pose
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn("[createBlockPoseClip] Missing skeleton or initial pose.");
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration]; // Start, End (Hold Block Pose)
    const deg = THREE.MathUtils.degToRad;
    const tmpEuler = new THREE.Euler();
    const tmpQuat = new THREE.Quaternion();

    // Use the exported blockTargets constant
    // const blockTargets = { ... }; // Removed local definition

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const initial = initialPose[boneName];
        if (!initial) return; 

        const stanceInfo = stancePoseTargets[boneName];
        let startQuat = new THREE.Quaternion(); 
        let startEulerOrder: EulerOrder = 'XYZ';

        // Determine start pose (Stance if defined, else Initial)
        if (stanceInfo?.rotation && stanceInfo.eulerOrder) {
            startEulerOrder = stanceInfo.eulerOrder;
            tmpEuler.set(deg(stanceInfo.rotation.x ?? 0), deg(stanceInfo.rotation.y ?? 0), deg(stanceInfo.rotation.z ?? 0), startEulerOrder);
            startQuat.setFromEuler(tmpEuler);
        } else {
            startQuat.copy(initial.quat);
             // Guess order for initial if needed (less critical here as we mainly use stance)
             if (boneName.includes('Upperarm') || boneName.includes('Forearm') || boneName.includes('Hand')) startEulerOrder = 'XYZ';
             else if (boneName.includes('Thigh') || boneName.includes('Calf') || boneName.includes('Foot')) startEulerOrder = 'YXZ';
             else startEulerOrder = 'XYZ'; // Default for torso/head
        }

        let endQuat = new THREE.Quaternion();
        const blockTarget = blockTargets[boneName];

        // Determine end pose (Block Target if defined, else Start Pose)
        if (blockTarget) {
            const bt = blockTarget.rotation;
            tmpEuler.set(deg(bt.x), deg(bt.y), deg(bt.z), blockTarget.eulerOrder);
            endQuat.setFromEuler(tmpEuler);
        } else {
            endQuat.copy(startQuat); // Keep non-blocking bones at their start/stance pose
        }

        // Add track for this bone
        const keyframeValues = [
            startQuat.x, startQuat.y, startQuat.z, startQuat.w,
            endQuat.x, endQuat.y, endQuat.z, endQuat.w
        ];
        tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, keyframeValues));
    });

    if (tracks.length === 0) { console.warn(`[createBlockPoseClip] No tracks generated for ${clipName}.`); return null; }
    // This clip transitions *to* the pose. The action using it might loop or clamp.
    return new THREE.AnimationClip(clipName, duration, tracks);
} 

// Define and export target rotations/positions for the ducking pose
export const duckTargets: Record<string, { 
    rotation?: { x: number; y: number; z: number }, 
    position?: { x?: number; y?: number; z?: number }, // Add optional position target
    eulerOrder?: EulerOrder 
}> = {
    // --- Torso Rotations (XYZ Order from Leva) ---
    // Keep Hip position offset ONLY
    'Hip':        { position: { z: -0.15 } }, // Keep Z position offset for Hip
    'Pelvis':     { rotation: { x: 5, y: -147, z: 10 }, eulerOrder: 'XYZ' },
    'Waist':      { rotation: { x: -111, y: -22, z: -147 }, eulerOrder: 'XYZ' },
    'Spine01':    { rotation: { x: 0, y: -3, z: 0 }, eulerOrder: 'XYZ' },
    'Spine02':    { rotation: { x: 0, y: 0, z: 0 }, eulerOrder: 'XYZ' },
    // --- Legs Rotations (XYZ Order from Leva) ---
    'L_Thigh':    { rotation: { x: -180, y: -87, z: -42 }, eulerOrder: 'XYZ' },
    'L_Calf':     { rotation: { x: 6, y: 9, z: 103 }, eulerOrder: 'XYZ' },
    'L_Foot':     { rotation: { x: -104, y: -151, z: 82 }, eulerOrder: 'XYZ' },
    'R_Thigh':    { rotation: { x: -180, y: -104, z: -42 }, eulerOrder: 'XYZ' },
    'R_Calf':     { rotation: { x: 6, y: 9, z: 103 }, eulerOrder: 'XYZ' },
    'R_Foot':     { rotation: { x: -104, y: -151, z: 82 }, eulerOrder: 'XYZ' },
    // ADD ARM TARGETS FOR DUCK? Or assume they stay in initial pose relative to torso?
    // For now, assume arms aren't explicitly targeted by duck, they will hold their 'stance' or 'initial' pose relative to the torso.
};

/**
 * Creates a transition animation to a ducking pose.
 * Starts from stance, moves body low (position + rotation), holds.
 */
export function createDuckPoseClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, InitialPoseData>, 
    stancePoseTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }>, 
    clipName: string = 'DuckPose', 
    duration: number = 0.4 // Increased duration from 0.4
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn("[createDuckPoseClip] Missing skeleton or initial pose.");
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration]; // Start, End (Hold Duck Pose)
    const deg = THREE.MathUtils.degToRad;
    const tmpEuler = new THREE.Euler();
    const tmpQuat = new THREE.Quaternion();
    const tmpVec = new THREE.Vector3(); // For position

    // Use the exported duckTargets constant

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const initial = initialPose[boneName];
        if (!initial) return; 

        const stanceInfo = stancePoseTargets[boneName];
        let startQuat = new THREE.Quaternion(); 
        let startPos = new THREE.Vector3(); // Get start position
        let startEulerOrder: EulerOrder = 'XYZ';

        // Determine start pose (Stance if defined, else Initial)
        startPos.copy(initial.pos); // Base position is always initial
        if (stanceInfo?.rotation && stanceInfo.eulerOrder) {
            startEulerOrder = stanceInfo.eulerOrder;
            tmpEuler.set(deg(stanceInfo.rotation.x ?? 0), deg(stanceInfo.rotation.y ?? 0), deg(stanceInfo.rotation.z ?? 0), startEulerOrder);
            startQuat.setFromEuler(tmpEuler);
             // Note: Stance targets currently don't define position offsets
        } else {
            startQuat.copy(initial.quat);
             // Guess order for initial if needed
             if (boneName.includes('Upperarm') || boneName.includes('Forearm') || boneName.includes('Hand')) startEulerOrder = 'XYZ';
             else if (boneName.includes('Thigh') || boneName.includes('Calf') || boneName.includes('Foot')) startEulerOrder = 'YXZ';
             else startEulerOrder = 'XYZ'; 
        }

        let endQuat = new THREE.Quaternion();
        let endPos = new THREE.Vector3().copy(startPos); // Default endPos is startPos
        const duckTarget = duckTargets[boneName]; // Use exported constant

        // Determine end pose (Duck Target if defined, else Start Pose)
        if (duckTarget) {
            // Apply Rotation Target
            if (duckTarget.rotation) {
                const dt = duckTarget.rotation;
                const order = duckTarget.eulerOrder || startEulerOrder;
                tmpEuler.set(deg(dt.x), deg(dt.y), deg(dt.z), order);
                endQuat.setFromEuler(tmpEuler);
            } else {
                 endQuat.copy(startQuat); // No rotation target, keep start rotation
            }
            // Apply Position Target (relative to startPos for simplicity)
            if (duckTarget.position) {
                 tmpVec.set(
                     duckTarget.position.x ?? 0,
                     duckTarget.position.y ?? 0, 
                     duckTarget.position.z ?? 0
                 );
                 endPos.add(tmpVec); // Add the offset defined in duckTargets
            }
            // else endPos remains startPos
        } else {
            endQuat.copy(startQuat); // Keep non-ducking bones at their start rotation
            // endPos remains startPos
        }

        // Add Rotation Track
        const quatKeyframeValues = [
            startQuat.x, startQuat.y, startQuat.z, startQuat.w,
            endQuat.x, endQuat.y, endQuat.z, endQuat.w
        ];
        tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, quatKeyframeValues));
        
        // Add Position Track ONLY if endPos is different from startPos
        if (!endPos.equals(startPos)) {
            const posKeyframeValues = [
                startPos.x, startPos.y, startPos.z,
                endPos.x, endPos.y, endPos.z
            ];
            tracks.push(new THREE.VectorKeyframeTrack(`${boneName}.position`, times, posKeyframeValues));
        }
    });

    if (tracks.length === 0) { console.warn(`[createDuckPoseClip] No tracks generated for ${clipName}.`); return null; }
    // Clip transitions *to* the pose. Action should clamp.
    return new THREE.AnimationClip(clipName, duration, tracks);
} 

/**
 * Creates a right kick animation starting from the ducking pose.
 */
export function createDuckKickClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, InitialPoseData>, 
    // stancePoseTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }>, // Don't need stance here
    clipName: string = 'DuckKick', 
    duration: number = 0.8 // Total duration: windup + kick + retract
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0 || Object.keys(duckTargets).length === 0) {
        console.warn("[createDuckKickClip] Missing skeleton, initial pose, or duck targets.");
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    // Define timings for the 5 keyframes
    const windupTime = duration * 0.15;
    const apexTime = duration * 0.4;
    const retractTime = duration * 0.7;
    const times = [0, windupTime, apexTime, retractTime, duration]; // Start(Current), Windup, Apex, Retract, End(Duck)
    
    const deg = THREE.MathUtils.degToRad;
    const tmpEuler1 = new THREE.Euler();
    const tmpQuat1 = new THREE.Quaternion();
    const tmpVec1 = new THREE.Vector3();
    const tmpEuler2 = new THREE.Euler();
    const tmpQuat2 = new THREE.Quaternion();
    const tmpVec2 = new THREE.Vector3();

    // Key bones involved
    const kickingLeg = ['R_Thigh', 'R_Calf', 'R_Foot'];
    const supportLeg = ['L_Thigh', 'L_Calf', 'L_Foot'];
    const torsoBones = ['Hip', 'Pelvis', 'Waist', 'Spine01', 'Spine02']; 
    // We might need arm bones later for balance, but let's keep them simple for now

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const initial = initialPose[boneName];
        if (!initial) return; 

        // --- Get Current Pose (Frame 0) ---
        // const currentQuat = bone.quaternion.clone(); // No longer using current pose directly
        // const currentPos = bone.position.clone();

        // --- Calculate Target End Pose (Duck Pose - Frame 4) ---
        const duckTarget = duckTargets[boneName];
        let targetDuckPoseQuat = new THREE.Quaternion().copy(initial.quat); // Default to initial if no target
        let targetDuckPosePos = new THREE.Vector3().copy(initial.pos);
        let duckPoseEulerOrder: EulerOrder = 'XYZ'; // Default order

        if (duckTarget) {
            if (duckTarget.rotation) {
                const dt = duckTarget.rotation;
                duckPoseEulerOrder = duckTarget.eulerOrder || 'XYZ'; 
                tmpEuler1.set(deg(dt.x), deg(dt.y), deg(dt.z), duckPoseEulerOrder);
                targetDuckPoseQuat.setFromEuler(tmpEuler1);
            } // else targetDuckPoseQuat remains initial.quat
            
            if (duckTarget.position) {
                 tmpVec1.set(
                     duckTarget.position.x ?? 0,
                     duckTarget.position.y ?? 0, 
                     duckTarget.position.z ?? 0
                 );
                 // Base the final position target on initial + offset
                 targetDuckPosePos.copy(initial.pos).add(tmpVec1); 
            } // else targetDuckPosePos remains initial.pos
        }
        // Now targetDuckPoseQuat and targetDuckPosePos hold the target state for the duck pose for this bone at the END of the animation.

        const keyframeQuatValues: number[] = [];
        const keyframePosValues: number[] = [];
        let hasPositionTrack = false; // Flag to track if we need a position track

        // --- Calculate Intermediate Keyframes (Windup, Apex, Retract) ---

        // Use the TARGET duck pose as the reference for calculating ALL keyframes (including start)
        const duckEuler = new THREE.Euler().setFromQuaternion(targetDuckPoseQuat, duckPoseEulerOrder);

        let windupQuat = new THREE.Quaternion();
        let apexQuat = new THREE.Quaternion();
        let retractQuat = new THREE.Quaternion();
        
        // Use the TARGET duck pose position as reference for intermediate positions
        let windupPos = new THREE.Vector3().copy(targetDuckPosePos);
        let apexPos = new THREE.Vector3().copy(targetDuckPosePos);
        let retractPos = new THREE.Vector3().copy(targetDuckPosePos);
        
        // Calculate intermediate poses based on modifications to the TARGET duck pose
        const windupEuler = new THREE.Euler().copy(duckEuler);
        const apexEuler = new THREE.Euler().copy(duckEuler);
        const retractEuler = new THREE.Euler().copy(duckEuler);

        // --- Define Kick Motion --- 
        if (kickingLeg.includes(boneName)) {
            const kickEulerOrder: EulerOrder = 'XYZ'; // Keep XYZ for consistency with duck targets

            // --- Apex (Frame 2): Define ABSOLUTE target rotations --- 
            apexEuler.copy(duckEuler); // Reset apexEuler to target duck
            if (boneName === 'R_Thigh') { 
                apexEuler.set(deg(-70), deg(-100), deg(6), kickEulerOrder);
            } 
            if (boneName === 'R_Calf') { 
                apexEuler.set(deg(10), deg(0), deg(0), kickEulerOrder);
            } 
            if (boneName === 'R_Foot') { 
                apexEuler.set(deg(-90), deg(116), deg(77), kickEulerOrder);
            }
            apexQuat.setFromEuler(apexEuler.reorder(kickEulerOrder));
            apexPos.copy(targetDuckPosePos); // Keep kicking leg bone positions at target duck reference

            // --- Windup (Frame 1): Blend towards apex (keep relative calc for now) --- 
             // Use the target duck pose as the base for windup calculation
             windupEuler.copy(duckEuler);
             if (boneName === 'R_Thigh') { windupEuler.x += deg(15); windupEuler.z += deg(-10); } // Adjustments relative to duck pose
             if (boneName === 'R_Calf') { windupEuler.z += deg(30); } 
             if (boneName === 'R_Foot') { windupEuler.x += deg(10); } 
             windupQuat.setFromEuler(windupEuler.reorder(kickEulerOrder));
             windupPos.copy(targetDuckPosePos); // Keep windup position same as target duck

            // Retract (Frame 3): Start bringing leg back towards the target duck pose
            // Recalculate retractEuler based on the target duck pose as reference
            retractEuler.copy(duckEuler); // Reset retractEuler to target duck
            if (boneName === 'R_Thigh') { retractEuler.x += deg(10); retractEuler.z += deg(-5); } 
            if (boneName === 'R_Calf') { retractEuler.z += deg(20); } 
            if (boneName === 'R_Foot') { retractEuler.x += deg(5); } 
            retractQuat.setFromEuler(retractEuler.reorder(kickEulerOrder));
            retractPos.copy(targetDuckPosePos); // Keep retract position same as target duck

        } else if (supportLeg.includes(boneName)) {
             // Keep support leg at the target duck pose throughout the intermediate frames
             apexQuat.copy(targetDuckPoseQuat); 
             apexPos.copy(targetDuckPosePos); 

             retractQuat.copy(targetDuckPoseQuat);
             retractPos.copy(targetDuckPosePos);
             windupQuat.copy(targetDuckPoseQuat);
             windupPos.copy(targetDuckPosePos); 

        } else if (torsoBones.includes(boneName)) {
             // Apex (Frame 2): Keep torso stable in the target duck pose to prevent rising
             apexQuat.copy(targetDuckPoseQuat);
             apexPos.copy(targetDuckPosePos); // Explicitly keep hip position down

             // Windup/Retract: Keep torso at target duck pose
             retractQuat.copy(targetDuckPoseQuat); 
             retractPos.copy(targetDuckPosePos);
             windupQuat.copy(targetDuckPoseQuat); // Windup matches target duck
             windupPos.copy(targetDuckPosePos);
        } else {
             // Other bones (arms, head): Keep at target duck pose throughout intermediate frames
             apexQuat.copy(targetDuckPoseQuat); 
             apexPos.copy(targetDuckPosePos); 
             retractQuat.copy(targetDuckPoseQuat);
             retractPos.copy(targetDuckPosePos);
             windupQuat.copy(targetDuckPoseQuat); // Windup matches target duck
             windupPos.copy(targetDuckPosePos);
        }
        
        // --- Add Keyframe Values --- 

        // Frame 0 (Start): Target Duck Pose
        keyframeQuatValues.push(targetDuckPoseQuat.x, targetDuckPoseQuat.y, targetDuckPoseQuat.z, targetDuckPoseQuat.w);
        keyframePosValues.push(targetDuckPosePos.x, targetDuckPosePos.y, targetDuckPosePos.z);

        // Frame 1 (Windup)
        keyframeQuatValues.push(windupQuat.x, windupQuat.y, windupQuat.z, windupQuat.w);
        keyframePosValues.push(windupPos.x, windupPos.y, windupPos.z);
        if (!hasPositionTrack && !windupPos.equals(targetDuckPosePos)) hasPositionTrack = true;

        // Frame 2 (Apex)
        keyframeQuatValues.push(apexQuat.x, apexQuat.y, apexQuat.z, apexQuat.w);
        keyframePosValues.push(apexPos.x, apexPos.y, apexPos.z);
        if (!hasPositionTrack && !apexPos.equals(targetDuckPosePos)) hasPositionTrack = true;

        // Frame 3 (Retract)
        keyframeQuatValues.push(retractQuat.x, retractQuat.y, retractQuat.z, retractQuat.w);
        keyframePosValues.push(retractPos.x, retractPos.y, retractPos.z);
        if (!hasPositionTrack && !retractPos.equals(targetDuckPosePos)) hasPositionTrack = true;

        // Frame 4 (End): Target Duck Pose
        keyframeQuatValues.push(targetDuckPoseQuat.x, targetDuckPoseQuat.y, targetDuckPoseQuat.z, targetDuckPoseQuat.w);
        keyframePosValues.push(targetDuckPosePos.x, targetDuckPosePos.y, targetDuckPosePos.z);

        // --- Add Tracks --- 
        tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, keyframeQuatValues));
        
        // Add Position Track ONLY if any intermediate frame's position differs from the start/end target duck position
        if (hasPositionTrack) {
            tracks.push(new THREE.VectorKeyframeTrack(`${boneName}.position`, times, keyframePosValues));
        }
    });

    if (tracks.length === 0) { console.warn(`[createDuckKickClip] No tracks generated for ${clipName}.`); return null; }
    return new THREE.AnimationClip(clipName, duration, tracks);
} 

// --- NEW: Hello Animation ---

// Define the target pose for the 'hello' wave start (based on screenshot)
export const helloTargets: Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }> = {
    'L_Upperarm': { rotation: { x: -33, y: 5, z: -63 }, eulerOrder: 'XYZ' },
    'L_Forearm':  { rotation: { x: 38, y: 42, z: -34 }, eulerOrder: 'XYZ' },
    'L_Hand':     { rotation: { x: 0, y: 0, z: 0 }, eulerOrder: 'XYZ' }, 
    'R_Upperarm': { rotation: { x: -29, y: 118, z: 69 }, eulerOrder: 'XYZ' },
    'R_Forearm':  { rotation: { x: 31, y: 23, z: 16 }, eulerOrder: 'XYZ' },
    'R_Hand':     { rotation: { x: 0, y: -54, z: -6 }, eulerOrder: 'XYZ' },
    // Note: Spine02 waving starts from its initial pose rotation + offset
};

/**
 * Creates a transition animation from the initial pose to the hello target pose.
 */
export function createTransitionToHelloClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, InitialPoseData>, 
    helloTargets: Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }>, 
    clipName: string = 'TransitionToHello', 
    duration: number = 0.75 // Slightly slower transition
): THREE.AnimationClip | null { 
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn("[createTransitionToHelloClip] Missing skeleton or initial pose.");
        return null;
    }
    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration];
    const deg = THREE.MathUtils.degToRad;
    const tmpEuler = new THREE.Euler();
    const tmpQuat = new THREE.Quaternion();

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const initial = initialPose[boneName];
        if (!initial) return; // Skip bone if no initial data
        
        const startQuat = initial.quat.clone();
        let endQuat = startQuat.clone();
        const targetInfo = helloTargets[boneName];
        
        if (targetInfo) {
            const eulerOrder = targetInfo.eulerOrder;
            const r = targetInfo.rotation;
            tmpEuler.set(deg(r.x), deg(r.y), deg(r.z), eulerOrder);
            endQuat.setFromEuler(tmpEuler);
        } // else endQuat remains startQuat (initial pose)
        
        // Add track if end is different from start
        if (!endQuat.equals(startQuat)) {
            tracks.push(new THREE.QuaternionKeyframeTrack(
                `${boneName}.quaternion`, 
                times, 
                [startQuat.x, startQuat.y, startQuat.z, startQuat.w, endQuat.x, endQuat.y, endQuat.z, endQuat.w]
            ));
        }
    });
    
    if (tracks.length === 0) { console.warn(`[createTransitionToHelloClip] No tracks generated for ${clipName}.`); return null; }
    return new THREE.AnimationClip(clipName, duration, tracks);
}

/**
 * Loops a wave motion (hand/spine) around a target pose.
 */
export function createHelloWaveLoopClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, InitialPoseData>, 
    helloTargets: Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }>, 
    clipName: string = 'HelloWaveLoop', 
    loopDuration: number = 5.0 // Slower loop duration (5 seconds)
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn("[createHelloWaveLoopClip] Missing skeleton or initial pose.");
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    // Define keyframe times more precisely
    const times = [
        0,                     // Start (Target Pose)
        loopDuration * 0.25,   // Wave Peak
        loopDuration * 0.75,   // Wave Trough
        loopDuration           // End (Target Pose - loop wraps)
    ];

    const deg = THREE.MathUtils.degToRad;
    const tmpEuler = new THREE.Euler();
    const tmpQuat = new THREE.Quaternion();

    const handWaveBone = 'R_Hand';
    const spineWaveBone = 'Spine02'; // Keep spine wave relative to initial?
    const handWaveAmount = 20; // Degrees +/- Y (Reset to original)
    const spineWaveAmount = 45; // Degrees +/- Y (Reset to original)

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const initial = initialPose[boneName];
        if (!initial) return; 

        const initialQuat = initial.quat.clone();
        const initialEulerOrder: EulerOrder = 'XYZ'; // Still needed for spine base

        let targetQuat = initialQuat.clone();
        let targetEulerOrder: EulerOrder = initialEulerOrder; // Explicitly type targetEulerOrder
        const helloTargetInfo = helloTargets[boneName];

        // Determine the 'base' pose for the wave part
        if (helloTargetInfo) {
            targetEulerOrder = helloTargetInfo.eulerOrder; 
            tmpEuler.set(deg(helloTargetInfo.rotation.x), deg(helloTargetInfo.rotation.y), deg(helloTargetInfo.rotation.z), targetEulerOrder);
            targetQuat.setFromEuler(tmpEuler);
        } // else targetQuat remains initialQuat (for bones not in helloTargets)

        const keyframeValues: number[] = [];

        // Frame 0: Target Pose (Loop start)
        keyframeValues.push(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w);

        // Frame 1: Wave Peak
        let peakQuat = new THREE.Quaternion();
        if (boneName === handWaveBone || boneName === spineWaveBone) {
            // Corrected: Both bones wave relative to their targetQuat for the loop
            const baseQuatForWave = targetQuat; 
            const waveEulerOrder = targetEulerOrder; // Use the target Euler order
            const waveAmount = (boneName === spineWaveBone) ? spineWaveAmount : handWaveAmount;
            
            tmpEuler.setFromQuaternion(baseQuatForWave, waveEulerOrder);
            tmpEuler.y += deg(waveAmount); // Add peak offset
            peakQuat.setFromEuler(tmpEuler);
            keyframeValues.push(peakQuat.x, peakQuat.y, peakQuat.z, peakQuat.w);

        } else {
            keyframeValues.push(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w); // Hold target pose
        }

        // Frame 2: Wave Trough
        let troughQuat = new THREE.Quaternion();
        if (boneName === handWaveBone || boneName === spineWaveBone) {
            // Corrected: Both bones wave relative to their targetQuat for the loop
            const baseQuatForWave = targetQuat;
            const waveEulerOrder = targetEulerOrder; // Use the target Euler order
            const waveAmount = (boneName === spineWaveBone) ? spineWaveAmount : handWaveAmount;
            
            tmpEuler.setFromQuaternion(baseQuatForWave, waveEulerOrder);
            tmpEuler.y -= deg(waveAmount); // Subtract trough offset
            troughQuat.setFromEuler(tmpEuler);
            keyframeValues.push(troughQuat.x, troughQuat.y, troughQuat.z, troughQuat.w);

        } else {
            keyframeValues.push(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w); // Hold target pose
        }

        // Frame 3: Target Pose (End of wave cycle - loops back to frame 0)
        // Corrected: Push targetQuat to loop smoothly
        keyframeValues.push(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w);

        // Add track
        tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, keyframeValues));
    });

    if (tracks.length === 0) { console.warn(`[createHelloWaveLoopClip] No tracks generated for ${clipName}.`); return null; }
    return new THREE.AnimationClip(clipName, loopDuration, tracks);
} 

// --- NEW: Arms Crossed Animation --- 

// Define the target pose for arms crossed (based on screenshot)
export const armsCrossedTargets: Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }> = {
    // Assume XYZ Order based on Leva
    'L_Upperarm': { rotation: { x: -39, y: -33, z: -130 }, eulerOrder: 'XYZ' },
    'L_Forearm':  { rotation: { x: 50, y: 26, z: -74 }, eulerOrder: 'XYZ' },
    'L_Hand':     { rotation: { x: 19, y: 0, z: -9 }, eulerOrder: 'XYZ' }, 
    'R_Upperarm': { rotation: { x: 14, y: 54, z: 88 }, eulerOrder: 'XYZ' },
    'R_Forearm':  { rotation: { x: 71, y: 16, z: 57 }, eulerOrder: 'XYZ' },
    'R_Hand':     { rotation: { x: 11, y: 21, z: 0 }, eulerOrder: 'XYZ' },
    // Other bones will hold their initial pose relative to the body
};

/**
 * Creates a transition animation from the initial pose to the arms crossed target pose.
 */
export function createTransitionToArmsCrossedClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, InitialPoseData>, 
    armsCrossedTargets: Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }>, 
    clipName: string = 'TransitionToArmsCrossed', 
    duration: number = 1.0 // Slow transition
): THREE.AnimationClip | null { 
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn("[createTransitionToArmsCrossedClip] Missing skeleton or initial pose.");
        return null;
    }
    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration];
    const deg = THREE.MathUtils.degToRad;
    const tmpEuler = new THREE.Euler();
    const tmpQuat = new THREE.Quaternion();

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const initial = initialPose[boneName];
        if (!initial) return; 
        
        const startQuat = initial.quat.clone();
        let endQuat = startQuat.clone();
        const targetInfo = armsCrossedTargets[boneName];
        
        if (targetInfo) {
            const eulerOrder = targetInfo.eulerOrder;
            const r = targetInfo.rotation;
            tmpEuler.set(deg(r.x), deg(r.y), deg(r.z), eulerOrder);
            endQuat.setFromEuler(tmpEuler);
        } // else endQuat remains startQuat (initial pose)
        
        // Add track if end is different from start
        if (!endQuat.equals(startQuat)) {
            tracks.push(new THREE.QuaternionKeyframeTrack(
                `${boneName}.quaternion`, 
                times, 
                [startQuat.x, startQuat.y, startQuat.z, startQuat.w, endQuat.x, endQuat.y, endQuat.z, endQuat.w]
            ));
        }
    });
    
    if (tracks.length === 0) { console.warn(`[createTransitionToArmsCrossedClip] No tracks generated for ${clipName}.`); return null; }
    return new THREE.AnimationClip(clipName, duration, tracks);
}

/**
 * Creates a looping breathing animation centered around the arms crossed pose.
 */
export function createArmsCrossedBreathClip(
    skeleton: THREE.Skeleton | null, 
    armsCrossedTargets: Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }>, 
    initialPose: Record<string, InitialPoseData>, // Still need initial for fallback
    clipName: string = 'ArmsCrossedBreath', 
    duration: number = 2.5, 
    intensity: number = 1.7 // Can reuse intensity from idle breath
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(armsCrossedTargets).length === 0 || Object.keys(initialPose).length === 0) {
        console.warn("[createArmsCrossedBreathClip] Missing skeleton, arms crossed targets, or initial pose.");
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration / 2, duration]; 
    const deg = THREE.MathUtils.degToRad;
    const tmpEuler = new THREE.Euler();
    const tmpQuat = new THREE.Quaternion();

    // Reuse the same bones as idle breath for subtle movement
    const breathingBones = ['Spine01', 'Spine02', 'Head', 'L_Clavicle', 'R_Clavicle', 'L_Upperarm', 'R_Upperarm']; 

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const targetInfo = armsCrossedTargets[boneName];
        const initial = initialPose[boneName]; // Needed for bones not in armsCrossedTargets
        
        let baseQuat = new THREE.Quaternion();
        let baseEulerOrder: EulerOrder = 'XYZ'; // Default

        // Determine the base pose: Use armsCrossedTarget if available, otherwise use initial pose
        if (targetInfo) {
            baseEulerOrder = targetInfo.eulerOrder;
            tmpEuler.set(deg(targetInfo.rotation.x), deg(targetInfo.rotation.y), deg(targetInfo.rotation.z), baseEulerOrder);
            baseQuat.setFromEuler(tmpEuler);
        } else if (initial) {
            baseQuat.copy(initial.quat); 
            // Guess initial order if needed (less critical, as these bones might not be in breathingBones)
            if (boneName.includes('Leg') || boneName.includes('Foot')) baseEulerOrder = 'YXZ'; 
        } else {
            return; // Skip bone if no target or initial data
        }

        if (breathingBones.includes(boneName)) {
            const peakQuat = new THREE.Quaternion();
            const deltaEuler = new THREE.Euler();
            const deltaIntensityRad = deg(intensity);

            // Apply same relative breathing offsets as idle breath
            if (boneName.includes('Spine')) {
                deltaEuler.x = -deltaIntensityRad;
            } else if (boneName.includes('Clavicle')) {
                deltaEuler.y = boneName.startsWith('L_') ? deltaIntensityRad * 0.5 : -deltaIntensityRad * 0.5;
            } else if (boneName.includes('Head')) {
                deltaEuler.x = -deltaIntensityRad * 0.5;
            } else if (boneName.includes('Upperarm')) {
                // Apply upper arm breath delta relative to the *arms crossed* base pose
                deltaEuler.z = boneName.startsWith('L_') ? -deltaIntensityRad * 0.3 : deltaIntensityRad * 0.3; 
            }
            
            // Calculate peak quaternion relative to the base (arms crossed or initial)
            const deltaQuat = new THREE.Quaternion().setFromEuler(deltaEuler);
            peakQuat.multiplyQuaternions(baseQuat, deltaQuat); // Apply delta to the determined baseQuat

            tracks.push(new THREE.QuaternionKeyframeTrack(
                `${boneName}.quaternion`, 
                times, 
                [
                    baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w, // Start at base
                    peakQuat.x, peakQuat.y, peakQuat.z, peakQuat.w, // Move to peak
                    baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w  // Return to base
                ]
            ));
        } else {
            // Keep non-breathing bones static at their base pose (arms crossed target or initial)
            tracks.push(new THREE.QuaternionKeyframeTrack(
                `${boneName}.quaternion`, 
                [0], // Only one keyframe needed for static bones
                [baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w]
            ));
        }
    });

    if (tracks.length === 0) { console.warn(`[createArmsCrossedBreathClip] No tracks generated for ${clipName}.`); return null; }
    return new THREE.AnimationClip(clipName, duration, tracks);
} 

// --- NEW: Bow Animation --- 

// Define the target pose for arms during the bow (based on screenshot)
export const bowArmTargets: Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }> = {
    // Assume XYZ Order based on Leva
    'L_Upperarm': { rotation: { x: -29, y: -4, z: -80 }, eulerOrder: 'XYZ' },
    'L_Forearm':  { rotation: { x: 118, y: 50, z: -55 }, eulerOrder: 'XYZ' },
    'L_Hand':     { rotation: { x: 0, y: 0, z: 0 }, eulerOrder: 'XYZ' }, 
    'R_Upperarm': { rotation: { x: -30, y: -4, z: 76 }, eulerOrder: 'XYZ' },
    'R_Forearm':  { rotation: { x: 135, y: -56, z: 68 }, eulerOrder: 'XYZ' },
    'R_Hand':     { rotation: { x: 0, y: 0, z: 0 }, eulerOrder: 'XYZ' },
};

/**
 * Creates a bowing animation.
 * Arms move to bow position, spine bends down and slightly further, then returns.
 */
export function createBowClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, InitialPoseData>, 
    clipName: string = 'Bow', 
    totalDuration: number = 4.5 // As described: 2s down, 2s further, 1.5s up
): THREE.AnimationClip | null { 
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn("[createBowClip] Missing skeleton or initial pose.");
        return null;
    }
    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, 1, 3.5, totalDuration]; // Key times for spine movement
    const deg = THREE.MathUtils.degToRad;
    const tmpEuler = new THREE.Euler();
    const tmpQuat = new THREE.Quaternion();
    const tmpQuat2 = new THREE.Quaternion();
    const tmpQuat3 = new THREE.Quaternion();

    const armBones = Object.keys(bowArmTargets);
    const spineBoneName = 'Spine01';

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const initial = initialPose[boneName];
        if (!initial) return; 
        
        const initialQuat = initial.quat.clone();
        const keyframeValues: number[] = [];

        if (armBones.includes(boneName)) {
            const targetInfo = bowArmTargets[boneName];
            let targetQuat = initialQuat.clone();
            if (targetInfo) {
                tmpEuler.set(deg(targetInfo.rotation.x), deg(targetInfo.rotation.y), deg(targetInfo.rotation.z), targetInfo.eulerOrder);
                targetQuat.setFromEuler(tmpEuler);
            }

            // Arms move to target by time 2, hold until time 4, then return by 5.5
            keyframeValues.push(initialQuat.x, initialQuat.y, initialQuat.z, initialQuat.w); // Time 0
            keyframeValues.push(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w); // Time 2
            keyframeValues.push(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w); // Time 4 (Hold)
            keyframeValues.push(initialQuat.x, initialQuat.y, initialQuat.z, initialQuat.w); // Time 5.5 (Return)
            tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, keyframeValues));

        } else if (boneName === spineBoneName) {
            const initialEuler = new THREE.Euler().setFromQuaternion(initialQuat, 'XYZ'); // Assume XYZ for Spine01
            
            // Calculate target quaternions
            tmpEuler.set(deg(-85), initialEuler.y, initialEuler.z, 'XYZ'); // Target 1: -85 deg X
            tmpQuat.setFromEuler(tmpEuler);

            tmpEuler.set(deg(-92), initialEuler.y, initialEuler.z, 'XYZ'); // Target 2: -92 deg X
            tmpQuat2.setFromEuler(tmpEuler);
            
            keyframeValues.push(initialQuat.x, initialQuat.y, initialQuat.z, initialQuat.w); // Time 0
            keyframeValues.push(tmpQuat.x, tmpQuat.y, tmpQuat.z, tmpQuat.w);         // Time 2 (-85 deg)
            keyframeValues.push(tmpQuat2.x, tmpQuat2.y, tmpQuat2.z, tmpQuat2.w);        // Time 4 (-92 deg)
            keyframeValues.push(initialQuat.x, initialQuat.y, initialQuat.z, initialQuat.w); // Time 5.5 (Return)
            tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, keyframeValues));

        } else {
            // For other bones, keep them at their initial pose throughout
            // Create a track that just holds the initial pose
            keyframeValues.push(initialQuat.x, initialQuat.y, initialQuat.z, initialQuat.w); // Time 0
            keyframeValues.push(initialQuat.x, initialQuat.y, initialQuat.z, initialQuat.w); // Time 5.5
            tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, [0, totalDuration], keyframeValues));
        }
    });
    
    if (tracks.length === 0) { console.warn(`[createBowClip] No tracks generated for ${clipName}.`); return null; }
    return new THREE.AnimationClip(clipName, totalDuration, tracks);
} 

// --- NEW: Left Punch ---

/**
 * Creates a left punch animation.
 * Starts from a provided startPose (or current if null), locks non-essential bones, returns arms to stance/initial.
 */
export function createLeftPunchClip(
    skeleton: THREE.Skeleton | null,
    initialPose: Record<string, InitialPoseData>,
    stancePoseTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }>, 
    startPose: StartPose | null = null,
    clipName: string = 'LeftPunch',
    duration: number = 0.6 
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn("[createLeftPunchClip] Missing skeleton or initial pose.");
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    // Define timings for the 4 keyframes
    const prepTime = duration * 0.1;
    const apexTime = duration * 0.35;
    const times = [0, prepTime, apexTime, duration]; // Start, Prep, Apex, End

    const deg = THREE.MathUtils.degToRad;
    const tmpEuler = new THREE.Euler();
    const tmpQuat = new THREE.Quaternion();

    // Key bones involved (Swapped L/R)
    const punchArm = ['L_Upperarm', 'L_Forearm', 'L_Hand'];
    const guardArm = ['R_Upperarm', 'R_Forearm', 'R_Hand'];
    const torsoBones = ['Pelvis', 'Spine01', 'Spine02']; 
    const headBone = 'Head';
    const rightLegBones = ['R_Thigh', 'R_Calf', 'R_Foot'];
    const leftLegBones = ['L_Thigh', 'L_Calf', 'L_Foot'];
    const legBones = [...rightLegBones, ...leftLegBones];

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const initial = initialPose[boneName];
        if (!initial) return;

        // --- Get STARTING pose --- 
        let currentQuat: THREE.Quaternion;
        if (startPose && startPose[boneName]) {
            currentQuat = startPose[boneName].quat.clone(); // Use passed start pose
        } else {
            console.warn(`[createLeftPunchClip] Start pose not found for ${boneName}, using live skeleton pose.`);
            currentQuat = bone.quaternion.clone(); // Fallback to live pose
        }
        
        // Determine a suitable Euler order
        let eulerOrder: EulerOrder = 'XYZ';
        const stanceInfo = stancePoseTargets[boneName];
        if (stanceInfo?.rotation && stanceInfo.eulerOrder) {
            eulerOrder = stanceInfo.eulerOrder;
        } else if (punchArm.includes(boneName) || guardArm.includes(boneName)) {
            eulerOrder = 'XYZ';
        } else if (legBones.includes(boneName)) { 
            eulerOrder = 'YXZ';
        } 
        const currentEuler = new THREE.Euler().setFromQuaternion(currentQuat, eulerOrder);

        // --- Determine TARGET Stance/Initial pose (only used for Arms' Frame 3) ---
        let targetEndQuat = new THREE.Quaternion();
        if (stanceInfo?.rotation && stanceInfo.eulerOrder) {
             tmpEuler.set(deg(stanceInfo.rotation.x ?? 0), deg(stanceInfo.rotation.y ?? 0), deg(stanceInfo.rotation.z ?? 0), stanceInfo.eulerOrder);
             targetEndQuat.setFromEuler(tmpEuler);
        } else {
            targetEndQuat.copy(initial.quat);
        }

        const keyframeValues: number[] = [];

        // --- Calculate Keyframes ---

        if (legBones.includes(boneName)) {
            // --- LOCK Leg Bones ---
            const quat = currentQuat;
            keyframeValues.push(quat.x, quat.y, quat.z, quat.w); // Frame 0
            keyframeValues.push(quat.x, quat.y, quat.z, quat.w); // Frame 1 (Prep)
            keyframeValues.push(quat.x, quat.y, quat.z, quat.w); // Frame 2 (Apex)
            keyframeValues.push(quat.x, quat.y, quat.z, quat.w); // Frame 3 (End)
        } else {
            // --- Animate Other Bones ---
            let finalQuat = new THREE.Quaternion();
            const shouldReturnToStance = punchArm.includes(boneName) || guardArm.includes(boneName);
            if (shouldReturnToStance) {
                finalQuat.copy(targetEndQuat); // Arms return to stance/initial
            } else {
                finalQuat.copy(currentQuat); // Torso, Head etc. return to current start pose
            }

            // Frame 0 (time 0): CURRENT Pose
            keyframeValues.push(currentQuat.x, currentQuat.y, currentQuat.z, currentQuat.w);

            // Frame 1 (time prepTime): Preparatory Pose
            let prepQuat = new THREE.Quaternion();
            if (punchArm.includes(boneName)) {
                // Calculate prep RELATIVE to current for punching arm (Left)
                let prepEuler = new THREE.Euler().copy(currentEuler);
                if (boneName === 'L_Upperarm') {
                     prepEuler.x += deg(5); // Same lean
                     prepEuler.z -= deg(15); // Mirror Z rotation (pull back left arm)
                 }
                 else if (boneName === 'L_Forearm') {
                     prepEuler.z -= deg(60); // Mirror Z rotation (bend elbow in)
                 }
                 else if (boneName === 'L_Hand') {
                     prepEuler.z -= deg(10); // Mirror Z rotation
                 }
                 prepQuat.setFromEuler(prepEuler.reorder(eulerOrder));
            } else {
                 // Other non-leg bones (Guard Arm, Torso, Head): HOLD current pose for prep frame
                 prepQuat.copy(currentQuat);
            }
            keyframeValues.push(prepQuat.x, prepQuat.y, prepQuat.z, prepQuat.w);

            // Frame 2 (time apexTime): Punch Apex
            let apexQuat = new THREE.Quaternion();
            if (punchArm.includes(boneName)) {
                // --- Use ABSOLUTE targets for punch arm (Left) - MIRRORED Y/Z from right ---
                if (boneName === 'L_Upperarm') { tmpEuler.set(deg(-20), deg(-78), deg(-38), 'XYZ'); } // Mirrored Y/Z
                else if (boneName === 'L_Forearm') { tmpEuler.set(deg(95), deg(92), deg(-95), 'XYZ'); } // Mirrored Y/Z
                else if (boneName === 'L_Hand') { tmpEuler.set(deg(-10), deg(-50), deg(10), 'XYZ'); } // Mirrored Y/Z
                 apexQuat.setFromEuler(tmpEuler.reorder('XYZ'));

            } else if (guardArm.includes(boneName)) {
                // --- Use ABSOLUTE targets for guard arm (Right) - MIRRORED Y/Z from left guard ---
                 if (boneName === 'R_Upperarm') { tmpEuler.set(deg(15), deg(40), deg(72), 'XYZ'); } // Mirrored Y/Z
                 else if (boneName === 'R_Forearm') { tmpEuler.set(deg(173), deg(-66), deg(55), 'XYZ'); } // Mirrored Y/Z
                 else if (boneName === 'R_Hand') { tmpEuler.set(deg(0), deg(0), deg(0), 'XYZ'); }
                apexQuat.setFromEuler(tmpEuler.reorder('XYZ'));

            } else if (torsoBones.includes(boneName)) {
                // Rotate torso RELATIVE to current pose (MIRRORED Y twist)
                tmpEuler.copy(currentEuler);
                if (boneName.includes('Spine01')) tmpEuler.y -= deg(70); // Apply twist opposite way
                if (boneName.includes('Spine')) tmpEuler.x += deg(5); // Keep lean same
                apexQuat.setFromEuler(tmpEuler.reorder(eulerOrder));

            } else {
                 // Other non-leg/non-arm/non-torso bones (Head etc.): HOLD current pose during apex
                 apexQuat.copy(currentQuat);
            }
            keyframeValues.push(apexQuat.x, apexQuat.y, apexQuat.z, apexQuat.w);

            // Frame 3 (time duration): Return towards determined final pose
            keyframeValues.push(finalQuat.x, finalQuat.y, finalQuat.z, finalQuat.w);
        }

        // Add track for this bone
        tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, keyframeValues));
    });

    if (tracks.length === 0) { console.warn(`[createLeftPunchClip] No tracks generated for ${clipName}.`); return null; }
    return new THREE.AnimationClip(clipName, duration, tracks);
}

// --- NEW: Fall Backward Animation ---

/**
 * Creates a fall backward animation.
 * Starts from a provided startPose (or current), transitions to lying on the back.
 */
export function createFallBackwardClip(
    skeleton: THREE.Skeleton | null,
    initialPose: Record<string, InitialPoseData>,
    startPose: StartPose | null = null, // Optional start pose
    clipName: string = 'FallBackward',
    duration: number = 1.5 // Duration for the fall
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn("[createFallBackwardClip] Missing skeleton or initial pose.");
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration * 0.6, duration]; // Keyframes: Start, Approx Impact, Final Rest
    const deg = THREE.MathUtils.degToRad;
    const tmpEuler = new THREE.Euler();
    const tmpQuat = new THREE.Quaternion();
    const tmpVec = new THREE.Vector3();
    const tmpQuat2 = new THREE.Quaternion(); // For interpolation
    const tmpVec2 = new THREE.Vector3(); // For interpolation

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const initial = initialPose[boneName];
        if (!initial) return;

        // --- Get STARTING pose (Frame 0) ---
        let startQuat: THREE.Quaternion;
        let startPos: THREE.Vector3;
        if (startPose && startPose[boneName]) {
            startQuat = startPose[boneName].quat.clone();
            // Position usually isn't in startPose, use current bone position
            startPos = bone.position.clone(); 
        } else {
            // Fallback to live skeleton pose if no startPose provided
            startQuat = bone.quaternion.clone();
            startPos = bone.position.clone();
        }

        // --- Define Final RESTING Pose (Frame 2) ---
        // This is the target pose lying on the back
        let finalQuat = new THREE.Quaternion();
        let finalPos = new THREE.Vector3().copy(initial.pos); // Base final position on initial relative offset

        // Set absolute rotations/positions for the final pose
        // Note: Exact values might need tweaking based on the specific model's proportions and origin
        if (boneName === 'Hip') {
            // Keep X from start, shift Y backward, set Z to ground level
            finalPos.x = startPos.x;
            finalPos.y = startPos.y + 0.9; // Shift "backward" (positive Y) from start Y
            finalPos.z = 0.15;           // <-- INCREASED Z offset to keep body higher
            tmpEuler.set(deg(132), deg(-150), deg(180), 'XYZ'); // Use user-provided rotation
            finalQuat.setFromEuler(tmpEuler);
        } else {
            // Other bones revert to their initial pose relative to the fallen hip
            finalQuat.copy(initial.quat);
            finalPos.copy(initial.pos); // Maintain relative offset from parent
        }

        // --- Define IMPACT Pose (Frame 1) ---
        // Interpolate rotation, calculate position for backward jump effect
        let impactQuat = new THREE.Quaternion();
        let impactPos = new THREE.Vector3();
        impactQuat.slerpQuaternions(startQuat, finalQuat, 0.6);

        if (boneName === 'Hip') {
            // Hip moves slightly back and UP for the impact/jump part
            impactPos.x = THREE.MathUtils.lerp(startPos.x, finalPos.x, 0.3); // Minimal X change
            impactPos.y = startPos.y + 0.3; // Shift slightly backward during impact
            impactPos.z = finalPos.z + 0.5; // Jump UP slightly relative to final ground Z
        } else {
            // Other bones interpolate normally between start and their final initial-relative pose
             impactPos.lerpVectors(startPos, finalPos, 0.7);
        }

        // --- Assemble Keyframe Values ---
        const quatValues = [
            startQuat.x, startQuat.y, startQuat.z, startQuat.w,
            impactQuat.x, impactQuat.y, impactQuat.z, impactQuat.w,
            finalQuat.x, finalQuat.y, finalQuat.z, finalQuat.w
        ];
        tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, quatValues));

        // Add position track ONLY if start, impact, or final positions differ
        if (!startPos.equals(finalPos) || !startPos.equals(impactPos) || !impactPos.equals(finalPos)) {
             const posValues = [
                 startPos.x, startPos.y, startPos.z,
                 impactPos.x, impactPos.y, impactPos.z,
                 finalPos.x, finalPos.y, finalPos.z
             ];
             tracks.push(new THREE.VectorKeyframeTrack(`${boneName}.position`, times, posValues));
        }
    });

    if (tracks.length === 0) { 
        console.warn(`[createFallBackwardClip] No tracks generated for ${clipName}.`); 
        return null; 
    }
    // This clip should not loop, the animation manager should clamp it at the end.
    return new THREE.AnimationClip(clipName, duration, tracks);
}

// Define the target pose for the special power preparation (based on screenshot 1)
export const specialPowerPrepTargets: Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }> = {
    // Assume XYZ Order based on Leva screenshot 1
    'L_Upperarm': { rotation: { x: -13, y: -51, z: -91 }, eulerOrder: 'XYZ' },
    'L_Forearm':  { rotation: { x: 88, y: 10, z: -50 }, eulerOrder: 'XYZ' },
    'L_Hand':     { rotation: { x: -10, y: 50, z: 17 }, eulerOrder: 'XYZ' },
    'R_Upperarm': { rotation: { x: -38, y: 19, z: 117 }, eulerOrder: 'XYZ' },
    'R_Forearm':  { rotation: { x: 34, y: -38, z: 54 }, eulerOrder: 'XYZ' },
    'R_Hand':     { rotation: { x: -4, y: 64, z: -10 }, eulerOrder: 'XYZ' },
};

// Define the target pose for the special power throwing (based on screenshot 2)
export const specialPowerThrowTargets: Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }> = {
    // Assume XYZ Order based on Leva screenshot 2
    'L_Upperarm': { rotation: { x: -13, y: -51, z: -107 }, eulerOrder: 'XYZ' },
    'L_Forearm':  { rotation: { x: 42, y: 0, z: -50 }, eulerOrder: 'XYZ' },
    'L_Hand':     { rotation: { x: -38, y: 68, z: 99 }, eulerOrder: 'XYZ' },
    'R_Upperarm': { rotation: { x: -38, y: 19, z: 134 }, eulerOrder: 'XYZ' },
    'R_Forearm':  { rotation: { x: 74, y: -53, z: 47 }, eulerOrder: 'XYZ' },
    'R_Hand':     { rotation: { x: -4, y: 125, z: -46 }, eulerOrder: 'XYZ' },
};

/**
 * Creates a special power throw animation.
 * Starts from a provided startPose (or current), moves arms only through prep and throw, then returns.
 */
export function createSpecialPowerThrowClip(
    skeleton: THREE.Skeleton | null,
    initialPose: Record<string, InitialPoseData>, // Keep for reference if needed, though not directly used for targets
    startPose: StartPose | null = null,
    clipName: string = 'SpecialPowerThrow',
    prepDuration: number = 0.5,   // Time to reach prep pose
    throwDuration: number = 0.5,  // Time from prep to throw pose
    prepPoseHoldDuration: number = 0.5, // Time to hold prep pose before throwing
    holdDuration: number = 1.0,   // Time to hold throw pose
    returnDuration: number = 0.5 // Time to return to start pose
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn(`[${clipName}] Missing skeleton or initial pose.`);
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    // Define timings for the 6 keyframes (Start, Prep End, Prep Hold End, Throw End, Throw Hold End, Return End)
    const prepTime = prepDuration;
    const prepHoldEndTime = prepTime + prepPoseHoldDuration;
    const throwTime = prepHoldEndTime + throwDuration;
    const throwHoldEndTime = throwTime + holdDuration;
    const totalDuration = throwHoldEndTime + returnDuration;
    const times = [0, prepTime, prepHoldEndTime, throwTime, throwHoldEndTime, totalDuration];

    const deg = THREE.MathUtils.degToRad;
    const tmpEuler = new THREE.Euler();
    const tmpPrepQuat = new THREE.Quaternion();
    const tmpThrowQuat = new THREE.Quaternion();

    // Identify arm bones
    const armBones = [
        'L_Upperarm', 'L_Forearm', 'L_Hand',
        'R_Upperarm', 'R_Forearm', 'R_Hand'
    ];

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const initial = initialPose[boneName]; // Used only for fallback if startPose missing
        if (!initial) return;

        // --- Get STARTING pose (Frame 0 / Frame 4 Target) ---
        let startQuat: THREE.Quaternion;
        if (startPose && startPose[boneName]) {
            startQuat = startPose[boneName].quat.clone(); // Use passed start pose
        } else {
            console.warn(`[${clipName}] Start pose not found for ${boneName}, using live skeleton pose.`);
            startQuat = bone.quaternion.clone(); // Fallback to live pose
        }

        const keyframeValues: number[] = [];

        if (armBones.includes(boneName)) {
            // --- Animate Arm Bones ---

            // Frame 0: Start Pose
            keyframeValues.push(startQuat.x, startQuat.y, startQuat.z, startQuat.w);

            // Frame 1 (prepTime): Reach Preparation Pose
            const prepTarget = specialPowerPrepTargets[boneName];
            let calculatedPrepQuat = new THREE.Quaternion().copy(startQuat); // Default to start if no target
            if (prepTarget) {
                const r = prepTarget.rotation;
                tmpEuler.set(deg(r.x), deg(r.y), deg(r.z), prepTarget.eulerOrder);
                tmpPrepQuat.setFromEuler(tmpEuler);
                calculatedPrepQuat.copy(tmpPrepQuat);
                keyframeValues.push(tmpPrepQuat.x, tmpPrepQuat.y, tmpPrepQuat.z, tmpPrepQuat.w);
            } else {
                console.warn(`[${clipName}] Prep target missing for arm bone ${boneName}, holding start pose.`);
                keyframeValues.push(startQuat.x, startQuat.y, startQuat.z, startQuat.w); // Hold start if no target
            }

            // Frame 2 (prepHoldEndTime): Hold Preparation Pose
            keyframeValues.push(calculatedPrepQuat.x, calculatedPrepQuat.y, calculatedPrepQuat.z, calculatedPrepQuat.w);

            // Frame 3 (throwTime): Reach Throwing Pose
            const throwTarget = specialPowerThrowTargets[boneName];
            let calculatedThrowQuat = new THREE.Quaternion().copy(calculatedPrepQuat); // Default to prep if no target
            if (throwTarget) {
                const r = throwTarget.rotation;
                tmpEuler.set(deg(r.x), deg(r.y), deg(r.z), throwTarget.eulerOrder);
                tmpThrowQuat.setFromEuler(tmpEuler);
                calculatedThrowQuat.copy(tmpThrowQuat);
                keyframeValues.push(tmpThrowQuat.x, tmpThrowQuat.y, tmpThrowQuat.z, tmpThrowQuat.w);
            } else {
                console.warn(`[${clipName}] Throw target missing for arm bone ${boneName}, holding prep pose.`);
                // If no throw target, hold the prep pose calculated above
                keyframeValues.push(calculatedPrepQuat.x, calculatedPrepQuat.y, calculatedPrepQuat.z, calculatedPrepQuat.w);
            }

            // Frame 4 (throwHoldEndTime): Hold Throwing Pose
            keyframeValues.push(calculatedThrowQuat.x, calculatedThrowQuat.y, calculatedThrowQuat.z, calculatedThrowQuat.w);

            // Frame 5 (totalDuration): Return to Start Pose
            keyframeValues.push(startQuat.x, startQuat.y, startQuat.z, startQuat.w);

        } else {
            // --- Lock Non-Arm Bones ---
            // Hold the start pose for all 6 keyframes
            keyframeValues.push(startQuat.x, startQuat.y, startQuat.z, startQuat.w); // Frame 0 (time 0)
            keyframeValues.push(startQuat.x, startQuat.y, startQuat.z, startQuat.w); // Frame 1 (prepTime)
            keyframeValues.push(startQuat.x, startQuat.y, startQuat.z, startQuat.w); // Frame 2 (prepHoldEndTime)
            keyframeValues.push(startQuat.x, startQuat.y, startQuat.z, startQuat.w); // Frame 3 (throwTime)
            keyframeValues.push(startQuat.x, startQuat.y, startQuat.z, startQuat.w); // Frame 4 (throwHoldEndTime)
            keyframeValues.push(startQuat.x, startQuat.y, startQuat.z, startQuat.w); // Frame 5 (totalDuration)
        }

        // Add track for this bone
        tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, keyframeValues));
    });

    if (tracks.length === 0) {
        console.warn(`[${clipName}] No tracks generated.`);
        return null;
    }
    return new THREE.AnimationClip(clipName, totalDuration, tracks);
}