; case strops-058-chrord
; expect exit=0 stdout="255\n"
.func main arity=0 locals=0
  PUSH_INT 255
  CHR
  ORD
  PRINT
  RET
.end
