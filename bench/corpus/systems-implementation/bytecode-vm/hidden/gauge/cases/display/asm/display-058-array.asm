; case display-058-array
; expect exit=0 stdout="[\"\\x1f\"]\n"
.func main arity=0 locals=0
  PUSH_INT 31
  CHR
  NEW_ARRAY 1
  PRINT
  RET
.end
