#!/usr/bin/env python3
import os
import sys

def main():
    # Assets
    base_dir = "../public"
    img_dir = f"{base_dir}/images"
    audio = f"{base_dir}/audio/master_soundtrack.mp3"
    
    clutter = [
        ("legacy-erp.jpg", 1.5, "1.2", "0", "0"),          # Phase 0
        ("dashboard-chaos.jpg", 1.5, "1.2", "iw/2", "0"),  # Phase 1
        ("report-overload.jpg", 1.5, "1.2", "iw/2", "ih/2"), # Phase 2
        ("complex-pos.jpg", 1.5, "1.2", "0", "ih/2"),      # Phase 3
        ("mobile-ledger.jpg", 1.5, "1.0", "iw/2", "ih/2")  # Phase 4
    ]
    
    glimpses = [
        ("dashboard.jpg", 2.6, 12.0),   # Scene 2 phase 0
        ("ai-chat.jpg", 2.6, 14.6),     # Scene 2 phase 1
        ("ai-journal.jpg", 2.8, 17.2),  # Scene 2 phase 2
        ("invoice.jpg", 2.25, 20.0),    # Scene 3 phase 0
        ("reports.jpg", 2.25, 22.25)    # Scene 3 phase 1
    ]
    
    inputs = []
    def add_input(path, opts=""):
        inputs.append((path, opts))
        return len(inputs) - 1

    # Base inputs
    audio_idx = add_input(audio)
    logo_idx = add_input(f"{img_dir}/tarseed-logo-transparent.png", "-loop 1 -t 2.5")
    
    filters = []
    
    def mk_noise():
        # Scene0 background
        filters.append(f"color=c=#09090b:s=1080x1920:d=2.5,setsar=1/1[s0_bg];")
        overlay_s0 = add_input(f"{img_dir}/overlays/s0.png", "-loop 1 -t 2.5")
        filters.append(f"[s0_bg][{overlay_s0}:v]overlay=0:0[s0_out];")
        return "s0_out"
    
    def mk_clutter():
        c_outs = []
        for i, (name, dur, z, px, py) in enumerate(clutter):
            img_idx = add_input(f"{img_dir}/clutter/{name}", f"-loop 1 -t {dur}")
            overlay_idx = add_input(f"{img_dir}/overlays/s1_{i}.png", f"-loop 1 -t {dur}")
            
            # Blur bg
            filters.append(f"[{img_idx}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1/1,boxblur=20[c_bg_{i}];")
            
            # Card image
            filters.append(f"[{img_idx}:v]scale=900:1300:force_original_aspect_ratio=decrease,pad=900:1300:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1/1[c_img_{i}];")
            # Fake identity blur: simple boxblur on a cropped section, then overlay back
            # For simplicity, we just put a semi-transparent black rectangle over the top-right
            filters.append(f"color=c=black@0.5:s=300x100:d={dur}[blur_{i}];")
            filters.append(f"[c_img_{i}][blur_{i}]overlay=W-w-20:20[c_card_{i}];")
            
            # Add red border (simple pad)
            filters.append(f"[c_card_{i}]pad=904:1304:2:2:color=#ef4444[c_card_b_{i}];")
            
            # Overlay card on bg
            filters.append(f"[c_bg_{i}][c_card_b_{i}]overlay=(W-w)/2:(H-h)/2[c_comp_{i}];")
            
            # Add overlay
            filters.append(f"[c_comp_{i}][{overlay_idx}:v]overlay=0:0[c_out_{i}];")
            c_outs.append(f"[c_out_{i}]")
            
        # Concat clutter scenes
        filters.append(f"{''.join(c_outs)}concat=n=5:v=1:a=0[s1_out];")
        return "s1_out"

    def mk_s1b():
        # Scene 1b: Black interstitial
        filters.append(f"color=c=black:s=1080x1920:d=2.0,setsar=1/1[s1b_bg];")
        overlay = add_input(f"{img_dir}/overlays/s1b.png", "-loop 1 -t 2.0")
        filters.append(f"[s1b_bg][{overlay}:v]overlay=0:0[s1b_out];")
        return "s1b_out"

    def mk_glimpse(scene_num, idx_range):
        # We need a continuous background for Scene 2 and Scene 3
        bg = "s2_base" if scene_num == 2 else "s3_base"
        color = "#010619"
        # Total duration
        durs = [glimpses[i][1] for i in idx_range]
        total_dur = sum(durs)
        
        filters.append(f"color=c={color}:s=1080x1920:d={total_dur},setsar=1/1[{bg}_c];")
        
        # Overlay top text
        top_text = add_input(f"{img_dir}/overlays/s{scene_num}_top.png", f"-loop 1 -t {total_dur}")
        filters.append(f"[{bg}_c][{top_text}:v]overlay=0:0[{bg}];")
        
        out = bg
        t_offset = 0
        for i in idx_range:
            name, dur, start_time = glimpses[i]
            img_idx = add_input(f"{img_dir}/glimpses/{name}", f"-loop 1 -t {dur}")
            cap_idx = add_input(f"{img_dir}/overlays/s{scene_num}_{i - idx_range.start}.png", f"-loop 1 -t {dur}")
            
            # Card image
            filters.append(f"[{img_idx}:v]scale=900:1200:force_original_aspect_ratio=decrease,pad=900:1200:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1/1[g_img_{i}];")
            filters.append(f"[g_img_{i}]pad=904:1204:2:2:color=#22d3ee[g_card_{i}];")
            
            # Composite caption on card
            # No, caption is full screen, so composite card then caption
            # We want the card and caption to appear ONLY during their duration
            
            # We use overlay with enable
            filters.append(f"[{out}][g_card_{i}]overlay=(W-w)/2:H-h-200:enable='between(t,{t_offset},{t_offset+dur})'[out_tmp_{i}];")
            filters.append(f"[out_tmp_{i}][{cap_idx}:v]overlay=0:0:enable='between(t,{t_offset},{t_offset+dur})'[out_final_{i}];")
            
            out = f"out_final_{i}"
            t_offset += dur
            
        filters.append(f"[{out}]copy[s{scene_num}_out];")
        return f"s{scene_num}_out"

    def mk_s4():
        filters.append(f"color=c=#010619:s=1080x1920:d=2.5,setsar=1/1[s4_bg];")
        glows = add_input(f"{img_dir}/overlays/s4_glows.png", f"-loop 1 -t 2.5")
        text = add_input(f"{img_dir}/overlays/s4_bottom.png", f"-loop 1 -t 2.5")
        
        # Logo needs scaling
        filters.append(f"[{logo_idx}:v]scale=600:-1,setsar=1/1[logo_scaled];")
        
        filters.append(f"[s4_bg][{glows}:v]overlay=0:0[s4_1];")
        filters.append(f"[s4_1][logo_scaled]overlay=(W-w)/2:(H-h)/2-100[s4_2];")
        filters.append(f"[s4_2][{text}:v]overlay=0:0[s4_out];")
        return "s4_out"

    s0 = mk_noise()
    s1 = mk_clutter()
    s1b = mk_s1b()
    s2 = mk_glimpse(2, range(0, 3))
    s3 = mk_glimpse(3, range(3, 5))
    s4 = mk_s4()
    
    filters.append(f"[{s0}]format=yuv420p,setsar=1/1[s0_fixed];")
    filters.append(f"[{s1}]format=yuv420p,setsar=1/1[s1_fixed];")
    filters.append(f"[{s1b}]format=yuv420p,setsar=1/1[s1b_fixed];")
    filters.append(f"[{s2}]format=yuv420p,setsar=1/1[s2_fixed];")
    filters.append(f"[{s3}]format=yuv420p,setsar=1/1[s3_fixed];")
    filters.append(f"[{s4}]format=yuv420p,setsar=1/1[s4_fixed];")
    
    filters.append(f"[s0_fixed][s1_fixed][s1b_fixed][s2_fixed][s3_fixed][s4_fixed]concat=n=6:v=1:a=0:unsafe=1[vout]")
    
    # Build command
    cmd = ["ffmpeg", "-y", "-v", "warning"]
    for path, opts in inputs:
        if opts:
            cmd.extend(opts.split())
        cmd.extend(["-i", path])
        
    cmd.extend([
        "-filter_complex", "".join(filters),
        "-map", "[vout]",
        "-map", f"{audio_idx}:a",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-r", "60",
        "-t", "27.0",
        "-movflags", "+faststart",
        "../exports/tarseed-launch-final.mp4"
    ])
    
    with open("render-final-offline.sh", "w") as f:
        f.write("#!/usr/bin/env bash\n")
        f.write("set -e\n")
        f.write("mkdir -p ../exports\n")
        # Format the command nicely
        f.write(" ".join(f'"{c}"' if " " in c or "[" in c or "=" in c else c for c in cmd) + "\n")
        
    os.chmod("render-final-offline.sh", 0o755)
    print("Generated render-final-offline.sh")

if __name__ == "__main__":
    main()
