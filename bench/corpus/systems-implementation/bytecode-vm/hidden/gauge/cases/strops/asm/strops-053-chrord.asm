; case strops-053-chrord
; expect exit=0 stdout="32\n"
.func main arity=0 locals=0
  PUSH_INT 32
  CHR
  ORD
  PRINT
  RET
.end
