; case compare-085-nestr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR ""
  PUSH_STR ""
  NE
  PRINT
  RET
.end
