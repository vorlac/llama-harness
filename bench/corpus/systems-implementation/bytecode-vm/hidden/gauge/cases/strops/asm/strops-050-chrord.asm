; case strops-050-chrord
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 0
  CHR
  ORD
  PRINT
  RET
.end
