#!/usr/bin/env python3
"""Deterministic diagnostics for the included immutable native-size PNG targets."""
import argparse, hashlib, json, tempfile
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
def array(p):
    rgba=Image.open(p).convert('RGBA');bg=Image.new('RGBA',rgba.size,'white');bg.alpha_composite(rgba)
    return np.asarray(bg.convert('RGB'),dtype=np.int16)
def difference(a,b):
    if a.shape!=b.shape:raise ValueError('Dimensions differ: no resampling is permitted')
    return np.max(np.abs(a-b),axis=2)>32
def region_score(diff,roi):
    x,y,w,h=roi
    if min(x,y)<0 or min(w,h)<=0 or y+h>diff.shape[0] or x+w>diff.shape[1]:raise ValueError('Invalid ROI')
    return float(100*(1-np.mean(diff[y:y+h,x:x+w])))
def self_test():
    a=np.zeros((10,10,3),dtype=np.int16);b=a.copy()
    assert not difference(a,b).any()
    b[0,0,0]=32;assert not difference(a,b).any()
    b[0,0,0]=33;d=difference(a,b);assert abs(region_score(d,[0,0,10,10])-99)<1e-8
    assert region_score(d,[1,1,9,9])==100
    try:difference(a,b[:9]);raise AssertionError('Shape mismatch accepted')
    except ValueError:pass
    try:region_score(d,[9,9,2,2]);raise AssertionError('Bad ROI accepted')
    except ValueError:pass
    assert not (91.9999>=92)
    print('PASS: 7 comparator assertions; no app screenshots measured')
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--self-test',action='store_true');ap.add_argument('--screen');ap.add_argument('--actual');ap.add_argument('--output');args=ap.parse_args()
    if args.self_test:self_test();return
    if not all([args.screen,args.actual,args.output]):ap.error('screen, actual and output are required')
    entries=json.loads((ROOT/'design/screen-manifest.json').read_text());entry=next((s for s in entries if s['id']==args.screen),None)
    if entry is None:raise ValueError('Unknown target screen')
    ref=ROOT/'design/plain'/(entry['id']+'.png');actual=Path(args.actual).resolve()
    if actual==ref.resolve():raise ValueError('Actual must be a separate implementation capture, not the reference file')
    pins=json.loads((ROOT/'qa/reference-hashes.json').read_text());sha=hashlib.sha256(ref.read_bytes()).hexdigest()
    if pins[entry['id']]!=sha:raise ValueError('Reference changed; restore immutable supplied target')
    a,b=array(ref),array(actual);diff=difference(a,b)
    cs=region_score(diff,entry['contentROI']);ws=region_score(diff,entry['workROI']);primary=min(cs,ws)
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    result={'screen':entry['id'],'referenceSHA256':sha,'actualSHA256':hashlib.sha256(actual.read_bytes()).hexdigest(),'dimensions':[a.shape[1],a.shape[0]],'thresholdMaxChannel':32,'maskCoverage':0,'content':cs,'work':ws,'fullDiagnostic':region_score(diff,[0,0,a.shape[1],a.shape[0]]),'primary':primary,'numericPass':primary>=92,'functionalAcceptance':'separate; not evaluated by this tool'}
    (out/'score.json').write_text(json.dumps(result,indent=2));heat=np.full((a.shape[0],a.shape[1],3),255,dtype=np.uint8);heat[diff]=[196,35,55];Image.fromarray(heat).save(out/'difference.png');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
